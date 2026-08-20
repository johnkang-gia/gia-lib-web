-- ===== 99. 도서관 시스템(gia-lib) 기반 =====
-- 요청: "학생들이 도서관을 이용할 때 바코드로 학생도서카드를 만들어서, 바코드를 찍으면 누가,
-- 어떤 책을 이용하는지에 관한 데이터를 기록하고... 나중에 디지털 학생증처럼 출결·행사입장·
-- 물건구입까지 학생카드 하나로 통합 관리" + "앱은 별도로, 데이터는 하나로".
--
-- 도서관 앱(gia-lib-web)은 별도의 Next.js 앱이지만 DB는 이 프로젝트를 그대로 씁니다. 그래서
-- 표(lib_*)와 보안규칙은 운영앱 저장소인 여기서 한 벌로 관리하고(= GitHub Actions가 자동 반영),
-- 도서관 앱은 그 표를 읽고 쓰기만 합니다.
--
-- 설계 요약
--   ① 학생 식별  - 이미 있는 wr_students.student_no(GIA-2026-0001)를 그대로 카드 바코드로 씁니다.
--                  도서관 앱에는 lib_students 뷰(이름/반/고유번호만)만 열어 개인정보를 넘기지
--                  않습니다.
--   ② 책 식별    - 책 뒷면 ISBN 바코드를 그대로 씁니다(라벨 부착 작업 없음). ISBN이 없는 책만
--                  자체 라벨(GIA-B-00001)을 발급해 붙입니다. 같은 책 여러 권은 total_copies
--                  수량으로 관리합니다.
--   ③ 가계정     - 도서관 노트북은 gia-library@giamicro.com 같은 전용 계정으로 로그인합니다.
--                  이 계정은 도서관 표와 학생 명부(이름/반/번호)만 볼 수 있고, 운영앱의
--                  사건기록·보호자 연락처 등에는 접근할 수 없습니다.

-- ── ① 도서관 전용 가계정 판정 ────────────────────────────────────────────────
-- gia-library@giamicro.com, gia-library2@giamicro.com 처럼 'gia-library'로 시작하는 회사
-- 계정을 도서관 전용 가계정으로 봅니다(계정을 늘려도 규칙을 다시 고칠 필요가 없게).
create or replace function is_library_account()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') like 'gia-library%@giamicro.com', false);
$$;

-- 도서관 앱을 쓸 수 있는 사람 = 회사 계정 전체(일반 교직원) + 도서관 가계정.
create or replace function is_lib_user()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'email') ilike '%@giamicro.com', false);
$$;

-- 운영앱 전체의 기본 판정 함수에서 도서관 가계정을 제외합니다. 이 한 줄로 gia-library 계정은
-- 사건/회의/업무/학생 원본 명부 등 운영앱의 모든 표에서 자동으로 차단됩니다(정책들이 전부
-- is_giamicro_user()를 쓰고 있기 때문입니다). 도서관 표는 위의 is_lib_user()를 쓰므로 영향이
-- 없습니다.
create or replace function is_giamicro_user()
returns boolean
language sql
stable
as $$
  select
    coalesce((auth.jwt() ->> 'email') ilike '%@giamicro.com', false)
    and not coalesce(lower(auth.jwt() ->> 'email') like 'gia-library%@giamicro.com', false);
$$;

-- ── ② 장서(lib_books) ────────────────────────────────────────────────────────
-- isbn: 하이픈을 뺀 13자리(또는 10자리) 문자열. 책에 인쇄된 바코드를 찍으면 그대로 들어옵니다.
-- item_code: ISBN이 없는 책에만 발급하는 자체 라벨 번호(GIA-B-00001).
-- total_copies: 같은 책 보유 권수. 대출 가능 권수 = total_copies - 현재 대출중 건수.
create table if not exists lib_books (
  id uuid primary key default gen_random_uuid(),
  isbn text,
  item_code text,
  title text not null,
  author text,
  publisher text,
  pub_year text,
  cover_url text,
  category text,
  language text not null default '한국어' check (language in ('한국어', '영어', '기타')),
  location text,
  total_copies integer not null default 1 check (total_copies >= 0),
  status text not null default '보유' check (status in ('보유', '폐기', '분실')),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 둘 중 하나는 반드시 있어야 스캔으로 찾을 수 있습니다.
  constraint lib_books_code_required check (isbn is not null or item_code is not null)
);
create unique index if not exists lib_books_isbn_idx on lib_books(isbn) where isbn is not null;
create unique index if not exists lib_books_item_code_idx on lib_books(item_code) where item_code is not null;
create index if not exists lib_books_title_idx on lib_books(lower(title));

-- 자체 라벨 번호 발급기. 앱에서 supabase.rpc('lib_next_item_code')로 호출합니다.
create sequence if not exists lib_item_no_seq;
create or replace function lib_next_item_code()
returns text
language sql
security definer
set search_path = public
as $$
  select 'GIA-B-' || lpad(nextval('lib_item_no_seq')::text, 5, '0');
$$;
grant execute on function lib_next_item_code() to authenticated;

-- ── ③ 대출(lib_loans) ────────────────────────────────────────────────────────
-- 학생 정보는 student_id(연결)와 함께 이름/번호/반을 그때 값 그대로도 남겨둡니다. 학생이
-- 졸업해 명부에서 빠지거나 반이 바뀌어도 "그때 누가 빌렸는지" 기록이 유지되어야 하기 때문입니다.
create table if not exists lib_loans (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references lib_books(id) on delete cascade,
  student_id uuid references wr_students(id) on delete set null,
  student_no text not null,
  student_name text not null,
  student_class text,
  borrowed_at timestamptz not null default now(),
  due_date date not null,
  returned_at timestamptz,
  renew_count integer not null default 0,
  status text not null default '대출중' check (status in ('대출중', '반납완료', '분실')),
  handled_by text,
  returned_by text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lib_loans_book_active_idx on lib_loans(book_id) where status = '대출중';
create index if not exists lib_loans_student_idx on lib_loans(student_no, borrowed_at desc);
create index if not exists lib_loans_due_idx on lib_loans(due_date) where status = '대출중';
create index if not exists lib_loans_recent_idx on lib_loans(borrowed_at desc);

-- ── ④ 도서관 입실 기록(lib_visits) ───────────────────────────────────────────
-- 화면은 2단계에서 붙이지만(요청: "대출/반납 먼저, 나중에 추가"), 표는 미리 만들어 둡니다.
-- 나중에 출결·행사입장으로 확장할 때도 같은 모양(카드 찍기 → 시각 기록)을 재사용합니다.
create table if not exists lib_visits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references wr_students(id) on delete set null,
  student_no text not null,
  student_name text not null,
  student_class text,
  kind text not null default '입실' check (kind in ('입실', '퇴실')),
  visited_at timestamptz not null default now(),
  device text
);
create index if not exists lib_visits_time_idx on lib_visits(visited_at desc);
create index if not exists lib_visits_student_idx on lib_visits(student_no, visited_at desc);

-- ── ⑤ 대출 규칙(lib_settings) ────────────────────────────────────────────────
-- 한 줄짜리 설정표입니다(id=1 고정). 화면에서 바로 고칠 수 있습니다.
create table if not exists lib_settings (
  id integer primary key default 1 check (id = 1),
  library_name text not null default 'GIA 도서관',
  loan_days integer not null default 14 check (loan_days between 1 and 365),
  max_books integer not null default 3 check (max_books between 1 and 50),
  allow_renew boolean not null default true,
  renew_days integer not null default 7 check (renew_days between 1 and 365),
  max_renew integer not null default 1 check (max_renew between 0 and 10),
  block_when_overdue boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into lib_settings (id) values (1) on conflict (id) do nothing;

-- ── ⑥ 갱신시각 자동 기록 ─────────────────────────────────────────────────────
drop trigger if exists lib_books_set_updated_at on lib_books;
create trigger lib_books_set_updated_at
  before update on lib_books
  for each row execute function set_updated_at();

drop trigger if exists lib_loans_set_updated_at on lib_loans;
create trigger lib_loans_set_updated_at
  before update on lib_loans
  for each row execute function set_updated_at();

drop trigger if exists lib_settings_set_updated_at on lib_settings;
create trigger lib_settings_set_updated_at
  before update on lib_settings
  for each row execute function set_updated_at();

-- ── ⑦ 보안규칙(RLS) ─────────────────────────────────────────────────────────
-- 도서관 표는 회사 계정(도서관 가계정 포함) 모두에게 열어둡니다. 운영앱의 다른 표들과 달리
-- 직위별로 나누지 않는 이유는, 도서관 데이터에는 민감한 개인정보가 없고(이름·반·빌린 책)
-- 담당 교직원이 누구든 대출 처리를 할 수 있어야 하기 때문입니다.
alter table lib_books enable row level security;
alter table lib_loans enable row level security;
alter table lib_visits enable row level security;
alter table lib_settings enable row level security;

drop policy if exists "lib_all_books" on lib_books;
create policy "lib_all_books" on lib_books
  for all using (is_lib_user()) with check (is_lib_user());

drop policy if exists "lib_all_loans" on lib_loans;
create policy "lib_all_loans" on lib_loans
  for all using (is_lib_user()) with check (is_lib_user());

drop policy if exists "lib_all_visits" on lib_visits;
create policy "lib_all_visits" on lib_visits
  for all using (is_lib_user()) with check (is_lib_user());

drop policy if exists "lib_all_settings" on lib_settings;
create policy "lib_all_settings" on lib_settings
  for all using (is_lib_user()) with check (is_lib_user());

-- ── ⑧ 도서관용 학생 명부 뷰 ─────────────────────────────────────────────────
-- 도서카드 바코드로 학생을 찾으려면 student_no가 필요한데, 교직원 공용 명부
-- (wr_students_basic)에는 개인정보 보호를 위해 student_no가 빠져 있습니다. 도서관에 꼭
-- 필요한 항목(고유번호·이름·학년·반)만 담은 별도 뷰를 만듭니다. 보호자 연락처·주소·생년월일·
-- 알러지 등은 일부러 뺐습니다.
-- 뷰는 원본 표의 보안규칙을 우회하므로, 뷰 자체에서 회사 계정인지 한 번 확인합니다.
drop view if exists lib_students;
create view lib_students as
select
  s.id,
  s.student_no,
  s.name,
  s.name_en,
  s.grade,
  s.class_name,
  s.department,
  s.status
from wr_students s
where is_lib_user();

revoke all on lib_students from anon;
grant select on lib_students to authenticated;

-- ── ⑨ 실시간 반영 ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lib_loans'
  ) then
    alter publication supabase_realtime add table lib_loans;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lib_visits'
  ) then
    alter publication supabase_realtime add table lib_visits;
  end if;
end $$;
