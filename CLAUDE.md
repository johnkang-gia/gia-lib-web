# GIA 도서관 앱(gia-lib-web)에서 지켜야 할 것

이 파일은 이 저장소에서 작업하는 사람과 AI 모두가 먼저 읽는 규칙입니다.

---

## 1. DB 는 운영앱과 하나입니다 — SQL 은 운영앱 저장소에 넣습니다

도서관 앱은 운영앱(gia-ops-web)과 **같은 Supabase** 를 씁니다. 표(`lib_*`)·뷰(`lib_students`)·
자물쇠(RLS)는 **운영앱 저장소의 마이그레이션 한 곳**에서 관리합니다. 운영앱 `main` 에 올라가면
GitHub Actions 가 자동으로 적용하고, 스키마 캐시 새로 읽기(`notify pgrst, 'reload schema'`)까지
합니다.

**표나 칸이 필요하면 SQL 을 사람에게 건네지 말고 직접 넣습니다.** 같은 컴퓨터에 두 저장소가
나란히 있습니다.

```
~/Desktop/GIA/Dev/gia-lib-web    ← 이 앱
~/Desktop/GIA/Dev/gia-ops-web    ← SQL 은 여기 supabase/migrations/
```

순서:

1. `gia-ops-web/supabase/migrations/YYYYMMDDHHMMSS_library_무엇.sql` 을 만듭니다.
   - 파일 이름의 시각은 **그 폴더의 마지막 파일보다 뒤**여야 합니다(`ls | tail -1` 로 확인).
   - `add column if not exists` · `create table if not exists` 처럼 **두 번 돌려도 안전하게** 씁니다.
   - 새 표는 같은 파일에서 RLS 를 켜고 정책을 붙입니다(`is_lib_user()`). 새 뷰는
     `security_invoker = on` + `revoke all … from anon` 을 함께 씁니다(운영앱 CLAUDE.md 2-8).
   - 새 표는 운영앱의 자료 등기소(`src/lib/registry/dataKinds.ts` 의 「도서관」 갈래)와 백업 목록
     (`src/lib/backupTables.ts` 의 「도서관」 묶음)에도 한 줄 더합니다. 안 하면 운영앱 빌드가 막습니다.
2. 운영앱에서 `npm run build` 로 검사를 통과시킨 뒤 `CHANGELOG.md` 에 한 항목, 버전 올리고 커밋·푸시
   (운영앱 CLAUDE.md 3 의 배포 순서).
3. **도서관 앱 코드는 그 칸이 아직 없어도 깨지지 않게** 씁니다. 코드가 먼저 배포되고 SQL 이 몇 분 뒤에
   걸리는 순간이 있습니다 - 기본값을 받쳐 두거나 칸 없이 한 번 더 묻습니다(`loadStudentsForCards`).
4. `src/app/api/health/route.ts` 의 REQUIRED 에 새 칸을 적습니다. 화면 위 점검 띠가 「아직 SQL 이
   적용되지 않았다」를 사람에게 알려줍니다.

**사람에게 SQL 을 복사해서 SQL 창에 붙이라고 하지 않습니다.** 손으로 돌린 SQL 은 마이그레이션 기록에
남지 않아서, 다음 자동 적용이 같은 일을 다시 하려다 실패하거나 두 곳의 모양이 어긋납니다.

## 2. 운영앱에서 오는 것

- **명부**: `lib_students` 뷰(= `wr_students` 그대로). 학생 번호(`student_no`)가 카드 바코드입니다.
- **명부가 바뀐 신호**: `lib_roster_version` 번호. `RosterLive` 가 듣고 화면을 다시 읽습니다.
- **부서 판정**: `src/lib/department.ts` 는 운영앱 `departmentOf` 와 같은 규칙입니다(학년 우선, 6학년은
  중고등부). 규칙을 바꿀 때는 **두 저장소를 함께** 고칩니다.

운영앱은 도서관 표를 **읽기만** 합니다(`/school/library`, 학생 프로필의 도서관 칸). 대출·반납·발급은
이 앱의 일입니다 - 두 앱이 같은 표를 고치면 두 화면이 다른 답을 하게 됩니다.

## 3. CHANGELOG

운영앱과 같은 규칙입니다(문제 → 원인 → 조치, 대화 인용 금지). `npm run build` 가 검사합니다.
