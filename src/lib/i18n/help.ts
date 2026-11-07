/**
 * **화면 설명 글의 영어** — 한 문장이 한 열쇠입니다.
 *
 * 이 앱의 도움말은 문장 가운데를 굵게 씁니다. 그 자리에 `<b>` 를 쓰면 한 문장이 화면에서
 * 토막 여러 개로 쪼개지고, 사전은 토막을 찾지 못해 영문 화면에 한국어가 섞여 남습니다.
 * 토막마다 번역을 붙이면 어순이 깨집니다 — 한국어는 서술어가 끝에, 영어는 앞에 옵니다.
 *
 * 그래서 화면 쪽에서 `rich(t("... **굵게** ..."))` 로 그리고, 그 글귀 전체를 여기 한 줄로
 * 옮겨 적습니다. `**` 는 두 말에서 서로 다른 자리를 굵게 할 수 있습니다 - 영어에서 강조할
 * 말이 한국어와 같은 자리에 있을 이유가 없습니다.
 */
export const EN_HELP: Record<string, string> = {
  "잘못된 요청입니다.":
    "That request was not valid.",
  "읽힌 값이 없습니다.":
    "Nothing was read.",
  "등록되지 않은 학생카드입니다.":
    "This student card is not registered.",
  "{code} - 운영앱 학생 명부에 없는 번호입니다.":
    "{code} — this number is not on the admin app's student roll.",
  "{name} 학생은 현재 재학중이 아닙니다.":
    "{name} is not currently enrolled.",
  "운영앱 학생 명부에서 상태를 확인해 주세요.":
    "Please check their status on the admin app's student roll.",
  "'{q}' 책 {n}권을 찾았습니다":
    "Found {n} books for ‘{q}’",
  "'{q}' 책을 찾지 못했습니다.":
    "No book found for ‘{q}’.",
  "제목이나 지은이의 일부만 입력해도 됩니다. 학생을 찾으시려면 위에서 「학생」으로 바꿔주세요.":
    "Part of a title or author is enough. To look for a student, switch to «Student» above.",
  "'{q}' 학생을 찾지 못했습니다.":
    "No student found for ‘{q}’.",
  "이름의 일부만 입력해도 됩니다. 책을 찾으시려면 위에서 「책」으로 바꿔주세요.":
    "Part of a name is enough. To look for a book, switch to «Book» above.",
  "'{q}' 을(를) 찾지 못했습니다.":
    "Nothing found for ‘{q}’.",
  "학생 이름이나 책 제목의 일부만 입력해도 됩니다.":
    "Part of a student's name or a book's title is enough.",
  "'{q}' 학생이 {n}명 있습니다 — 골라주세요":
    "{n} students match ‘{q}’ — please pick one",
  "책을 조회하지 못했습니다 — {why}":
    "The book lookup failed — {why}",
  "알 수 없는 오류":
    "unknown error",
  "같은 책이 등급별로 {n}줄 있습니다 — 어느 쪽인지 골라주세요":
    "This book has {n} rows, one per level — please pick which one",
  "이 바코드는 {n}권이 함께 쓰는 상품코드입니다 — 어느 책인지 골라주세요":
    "This barcode is a product code shared by {n} books — please pick which one",
  "아직 등록되지 않은 책입니다.":
    "This book is not registered yet.",
  "학생카드를 다시 찍어주세요.":
    "Please scan the student card again.",
  "이 책은 '{status}' 상태라 대출할 수 없습니다.":
    "This book is marked ‘{status}’, so it cannot go out.",
  "이 책은 보유한 권수가 모두 대출중입니다.":
    "Every copy of this book is on loan.",
  "보유 {a}권 / 대출중 {b}권":
    "{a} held / {b} on loan",
  "한 사람이 빌릴 수 있는 최대 {n}권을 채웠습니다.":
    "They have reached the limit of {n} books per person.",
  "학생 · 먼저 반납해야 새로 빌릴 수 있습니다.":
    "— something must come back before anything else goes out.",
  "연체 중인 책이 있어 대출할 수 없습니다.":
    "There is an overdue book, so nothing can go out.",
  "학생 · 연체 {n}권":
    "— {n} overdue",
  "대출 기록을 저장하지 못했습니다.":
    "The loan could not be saved.",
  "대출 완료":
    "Checked out",
  "지금 대출중이 아닌 책입니다.":
    "This book is not on loan right now.",
  "연장이 허용되어 있지 않습니다.":
    "Renewals are not allowed.",
  "연장은 최대 {n}회까지입니다":
    "Renewals are limited to {n}",
  "— 오늘 반납해 주세요":
    "— please return it today",
  "연장을 저장하지 못했습니다.":
    "The renewal could not be saved.",
  "{day}까지 연장":
    "Renewed until {day}",
  "반납 처리를 저장하지 못했습니다.":
    "The return could not be saved.",
  "반납 완료 ({n}일 연체)":
    "Returned ({n} days overdue)",
  "반납 완료":
    "Returned",
  "학생 · 빌린 책 {n}권":
    "— {n} books out",
  "로그인이 필요합니다.":
    "Please sign in.",
  "학생카드를 먼저 찍어주세요.":
    "Scan the student card first.",
  "대출할 책이 없습니다.":
    "There are no books to check out.",
  "학생을 찾지 못했습니다.":
    "That student could not be found.",
  "한 사람이 빌릴 수 있는 최대 {n}권을 이미 채웠습니다.":
    "They have already reached the limit of {n} books per person.",
  "{n}권은 많습니다 — {room}권까지 빌릴 수 있습니다.":
    "{n} is too many — up to {room} can go out.",
  "학생 · 지금 빌린 책 {a}권 / 최대 {b}권":
    "— {a} books out now / limit {b}",
  "장서에서 찾지 못했습니다":
    "Not found in the catalog",
  "(없어진 책)":
    "(missing book)",
  "'{status}' 상태입니다":
    "Marked ‘{status}’",
  "보유 {n}권이 모두 대출중입니다":
    "All {n} copies are on loan",
  "저장하지 못했습니다":
    "Could not be saved",
  "학생 · {day}까지 반납":
    "— due back {day}",
  "{a}권 대출 · {b}권은 못 빌렸습니다":
    "{a} checked out · {b} could not go out",
  "대출 중 오류가 생겼습니다":
    "Something went wrong during checkout",
  "학생을 골라주세요":
    "Please pick a student",
  "빌릴 수 있는 권수가 없습니다":
    "No copies available",
  "어느 책인지 눌러주세요":
    "Press the one you mean",
  "등록되지 않은 책입니다":
    "This book is not registered",
  "처리 중 오류가 생겼습니다":
    "Something went wrong",
  "다시 찍어주세요.":
    "Please scan it again.",
  "대출하지 못했습니다":
    "Could not check out",
  "(삭제된 책)":
    "(deleted book)",
  "{zone} 칸으로 모음":
    "gathered into slot {zone}",
  "합치는 중…":
    "Merging…",
  "합칠 줄을 고르세요":
    "Pick the rows to merge",
  "{rows}줄 합치기 → {n}권":
    "Merge {rows} rows → {n} copies",
  "{zone} 칸으로":
    "to slot {zone}",
  "새로 등록 {n}권":
    "{n} newly registered",
  "복본 추가 {n}권":
    "{n} copies added",
  "방금 등록한 책 라벨 {n}장 인쇄":
    "Print {n} labels for the books just registered",
  "모아둔 {a}장과 합쳐 {b}장 인쇄":
    "Print {b} by adding to the {a} already collected",
  "다 뽑았음 — 모아둔 {n}장 비우기":
    "All printed — clear the {n} collected",
  "표지에서 읽은 제목":
    "Title read from the cover",
  "(틀렸으면 고쳐주세요)":
    "(correct it if it is wrong)",
  "{n}번 더 찍혔습니다.":
    "Scanned {n} more times.",
  "잘못해서 두 번 찍으신 건가요, 아니면 같은 책이 여러 권 있나요?":
    "Was that a double scan by mistake, or are there several copies of the same book?",
  "같은 책이 여러 권 — {n}권 추가":
    "Several copies of the same book — add {n}",
  "담긴 책 {n}권":
    "{n} books in the list",
  "(등록 준비 {n}권)":
    "({n} ready to register)",
  "라벨 {lv}-":
    "Label {lv}-",
  "자리 등록에서 **찍어서 센 권수**를 참인 값으로 보고 장서의 보유 권수를 맞춥니다.":
    "Takes **the count scanned in Record locations** as the truth and brings the catalog's held count into line.",
  "3권짜리 책이 책장에서 세 권 나오는 것은 새로운 사실이 아닙니다. 그런데 세는 동안 ‘장서추가’를 누른 만큼 보유 권수가 부풀었습니다. 찍기 **전부터** 대출 나가 있던 책은 칸에 없었으니 세어지지 않았고, 그 몫만 더해 줍니다(찍은 뒤에 나간 책은 이미 세어졌습니다). 대출 중인 권수보다 적게는 내리지 않습니다.":
    "Finding three copies of a three-copy book on the shelf is not news. But the held count grew by every press of ‘Add to catalog’ during the counting. Books already on loan **before** the scanning were not in the slots and so were never counted; only those are added back (books that went out after being scanned are already counted). The count is never lowered below the number on loan.",
  "자리 등록에서 **한 번도 안 찍은 책은 건드리지 않습니다.** 아직 안 돈 칸에 같은 책이 더 있으면 그 칸을 찍는 순간 적힌 권수를 넘으므로, 앱이 그때 ‘장서추가’를 물어봅니다.":
    "**Books never scanned in Record locations are left alone.** If more copies sit in a slot you have not reached, scanning that slot will exceed the recorded count, and the app will ask about ‘Add to catalog’ then.",
  "찍어서 센 책 **{n}종**":
    "**{n} titles** counted by scanning",
  "어긋난 책 {n}종":
    "{n} titles out of step",
  "전부 맞습니다":
    "Everything matches",
  "🧮 {n}종 전부 맞추기":
    "🧮 Reconcile all {n} titles",
  "내릴 책 {a}종 · 올릴 책 {b}종":
    "{a} titles to lower · {b} to raise",
  "찍어서 센 권수 **{n}권**":
    "**{n}** counted by scanning",
  "찍기 전부터 대출 {n}권":
    "{n} on loan before the scanning",
  "지금 대출 중 {n}권":
    "{n} on loan now",
  "{n}종의 제목을 바꿨습니다.":
    "Changed the title of {n} books.",
  "{n}종은 바꾸지 못했습니다: {why}":
    "{n} could not be changed: {why}",
  "그대로 둘 것 {n}종":
    "{n} to leave as they are",
  "더 자세한 제목 있음 {n}종":
    "{n} with a fuller title available",
  "사람이 봐야 함 {n}종":
    "{n} need a person to look",
  "조회처가 못 찾음 {n}종":
    "{n} not found by any source",
  "이미 바꿈 {n}종":
    "{n} already changed",
  "① 덜 적힌 제목 {n}종 — 묶어서 바꿔도 됩니다":
    "① {n} incomplete titles — these can be changed in one go",
  "② 지금 제목과 겹치지 않는 것 {n}종 — 하나씩 봐주세요":
    "② {n} that do not overlap the current title — please check one by one",
  "고른 것만 바꾸기 ({n}종)":
    "Change only the selected ({n})",
  "고칠 제목이 남아 있지 않습니다.":
    "No titles left to fix.",
  "조회처가 못 찾은 {n}종은 「처음부터 다시」로 한 번 더 물어볼 수 있습니다.":
    "The {n} no source could find can be asked about once more with «Start over».",
  "바꾼 제목 (최근 {n}종)":
    "Titles changed (last {n})",
  "제목이 같은 줄끼리 묶어 **이름순**으로 늘어놓습니다. 장서 {all}종 중 **{g}묶음** · 합치면 {rows}줄이 줄어듭니다.":
    "Rows with the same title are grouped and listed **by name**. **{g} groups** out of {all} catalog titles · merging removes {rows} rows.",
  "합치면 → {zone} 칸으로 모읍니다":
    "On merge → gathered into slot {zone}",
  "— 합쳤습니다":
    "— merged",
  "{rows}줄 · 합치면 {n}권":
    "{rows} rows · {n} copies once merged",
  "학생 고유번호(GIA-2026-0001)가 바코드로 들어간 카드를 신용카드 크기(86 × 54mm)로 인쇄합니다. A4 한 장에 10장씩 나오며, 두꺼운 종이에 인쇄해 자르고 코팅하면 됩니다.":
    "Prints cards at credit-card size (86 × 54mm) with the student number (GIA-2026-0001) as a barcode. Ten per A4 sheet — print on heavy stock, cut and laminate.",
  "한 장에 **{n}명분**":
    "**{n} cards** per sheet",
  "(일부는 눕혀서)":
    "(some laid on their side)",
  "선택한 {n}명이면 {sheets}장":
    "{n} selected means {sheets} sheets",
  "선택한 {n}명의 이름 표기를":
    "Set the name style of the {n} selected to",
  "📷 사진 있는 {n}명만 선택":
    "📷 Select only the {n} with photos",
  "선택한 {n}명 카드 인쇄":
    "Print cards for the {n} selected",
  "구역 목록 ({n}개)":
    "Zone list ({n})",
  "라벨색":
    "Label colour",
  "색":
    "Colour",
  "← {n}권으로":
    "← set to {n}",
  "전체 선택":
    "Select all",
  "이 칸에 지금 들어 있는 권수를 이 칸의 수용량으로 기록합니다":
    "Records the number now in this slot as the slot's capacity",
  "무엇이 언제 바뀌었는지 최신 순으로 보여줍니다. 새로 배포한 뒤 이 숫자가 올라가 있으면 반영이 끝난 것입니다. 그대로라면 아직 올라가는 중이거나, 브라우저가 옛 화면을 쥐고 있는 것입니다(Ctrl + Shift + R 로 새로고침).":
    "Shows what changed and when, newest first. If this number has gone up after a deploy, the deploy has landed. If it has not, the deploy is still going up, or the browser is holding an old page (refresh with Ctrl + Shift + R).",
  "지금 보고 있는 화면은 **{now}** 인데 기록의 맨 위는 **{top}** 입니다. 배포가 아직 끝나지 않았을 수 있습니다.":
    "The screen you are looking at is **{now}**, but the top of the log is **{top}**. The deploy may not have finished.",
  "인쇄 기록 표를 아직 읽을 수 없습니다 — 운영앱(gia-ops)의 마이그레이션이 아직 적용되지 않았을 수 있습니다. 적용되면 이 화면이 바로 동작합니다.":
    "The print-records table cannot be read yet — the admin app's (gia-ops) migration may not have been applied. Once it is, this screen works straight away.",
  "{n}장 모아두는 중 · A4 한 장에 27장":
    "{n} collected so far · 27 per A4 sheet",
  "{when}에 마지막으로 열었습니다":
    "last opened {when}",
  "✓ {when}에 뽑았다고 표시됨":
    "✓ marked as printed {when}",
  "{n}건":
    "{n}",
  "학생 명부는 운영앱(gia-ops)에서 관리합니다. 이 앱은 같은 데이터베이스의 학생 고유번호와 이름·학년·반만 읽어 씁니다. 학생이 새로 들어오면 운영앱에 등록한 뒤 도서카드를 인쇄하세요.":
    "The student roll is managed in the admin app (gia-ops). This app only reads the student number, name, grade and class from the same database. When a new student arrives, register them in the admin app, then print a library card.",
  "통째로 {ak}종 {ac}권 · 일부만 {bk}종 {bc}권 — 모두 {all}권":
    "Entirely missing: {ak} titles, {ac} copies · partly missing: {bk} titles, {bc} copies — {all} copies in all",
  "모두 {n}권":
    "{n} copies in all",
  "{k}종 {c}권":
    "{k} titles, {c} copies",
  "{k}종 · 기록상 {c}권 · 줄에 적힌 자리 {z}곳":
    "{k} titles · {c} copies on record · {z} locations noted on the rows",
  "{k}종 · 기록상 {c}권":
    "{k} titles · {c} copies on record",
  "임시 자리: {zone}":
    "Temporary location: {zone}",
  "(줄에 적힌 자리)":
    "(the location noted on the row)",
  "라벨이 적힌 책 **{n}종**":
    "**{n} titles** with a label number",
  "라벨 없이 등록된 책 **{n}종**":
    "**{n} titles** registered without a label",
  "번호 겹침 {n}건":
    "{n} duplicate numbers",
  "그중 재등록에서 지나간 책 **{n}종**":
    "of which **{n} titles** were passed over during re-registering",
  "장서 **{n}권**":
    "**{n}** in catalog",
  "책장 **{n}권**":
    "**{n}** on shelf",
  "한 번에 쭉 찍어 넣은 책들이 **등록한 시각별로** 묶여 있습니다. 구역을 잘못 골랐으면 묶음째 옮기고, 한 권만 이상하면 그 줄에서 바로 고치세요. 최근 {n}권까지 보여줍니다":
    "Books scanned in one run are grouped **by the time they were registered**. If the zone was wrong, move the whole group; if just one book is off, fix it on its row. Shows the most recent {n}",
  "오늘 등록 **{n}권**":
    "**{n}** registered today",
  "모두 **{n}권**":
    "**{n}** in all",
  "영어책 {n}권":
    "{n} in English",
  "{by}로 정리":
    "grouped by {by}",
  "{n}권":
    "{n} books",
  "GIA 도서관":
    "GIA Library",
  "{day} 출력":
    "printed {day}",
  "{n}월":
    "{n}",
  "반별 —":
    "By class —",
  "권수만 보면 큰 반이 늘 1등입니다. 오른쪽이 한 사람당 권수입니다.":
    "By raw count the biggest class always wins. The figure on the right is per student.",
  "그중 한 번도 나간 적 없음 {n}종":
    "of which {n} titles have never gone out",
  "옮길 책 {n}권 · 지금 꽂힌 칸 {z}곳":
    "{n} books to move · {z} slots they sit in now",
  "({n}권)":
    "({n} copies)",
  "모두 **{n}칸**":
    "**{n} slots** in all",
  "— 이제 **여러 권 등록**에서 칸을 고르고 바코드를 찍으면 됩니다.":
    "— now pick the slot in **Batch register** and start scanning.",
  "— 지금 {n}권":
    "— {n} now",
  "{a}로":
    "to {a}",
  "책장 구역 라벨 {n}장 · A4 {p}장":
    "{n} shelf zone labels · {p} A4 sheets",
  "**{n}칸이 아직 「임시」입니다** — 정리를 마치고 **정식 책장으로 등록**한 뒤에 뽑으시면 아래 범위가 그대로 맞습니다(정리 계획 화면 ⑤). 지금 뽑으면 정리 뒤에 다시 뽑아야 할 수 있습니다.":
    "**{n} slots are still «temporary»** — print these after the tidying is done and the shelves are **registered as permanent**, and the ranges below will be right (tidy plan screen ⑤). Printing now may mean printing again after the tidy.",
  "({n}회 연장)":
    "({n} renewals)",
  "이미 {zone} 칸입니다":
    "Already in slot {zone}",
  "{n}회":
    "{n}",
  "v{v} · 버전 기록":
    "v{v} · change log",
  "보유 {a}권 · 대출 가능 {b}권":
    "{a} held · {b} available",
  "없는 칸 {n}개 보기":
    "Show the {n} missing slots",
  "도서카드 {n}장 · {paper} {dir} {sheets}장 · {card}":
    "{n} library cards · {sheets} sheets of {paper} {dir} · {card}",
  "사진 포함":
    "with photos",
  "접이식(앞뒤 한 장)":
    "fold-over (front and back on one piece)",
  "양면(따로 두 장)":
    "double-sided (two separate sheets)",
  "책 바코드 라벨 {n}장":
    "{n} book barcode labels",
  "{zone} 을 {after}권으로 바꿨습니다":
    "{zone} is now recorded as {after}",
  "전에는 {n}권":
    "was {n}",
  "떠난 책 {n}종을 지웠습니다":
    "removed {n} titles that had left",
  "🔄 {lv}등급 책장을 지금 다시 찍기":
    "🔄 Rescan the level-{lv} shelves now",
  "칸마다 통째로 바꿉니다 — 떠난 책이 기록에서 사라집니다":
    "Each slot is replaced wholesale — books that left disappear from the record",
  "지금 기록 **{n}권**":
    "On record now: **{n}**",
  "({n}종)":
    "({n} titles)",
  "장서에 없는 책입니다 —":
    "This book is not in the catalog —",
  "재등록 · 라벨 뽑기":
    "Re-register · print labels",
  "에서 먼저 등록하고 오세요. 찍은 목록은 그대로 있습니다.":
    " — register it there first and come back. What you have scanned stays.",
  "등급없음":
    "no level",
  "장서 {n}권":
    "{n} in catalog",
  "지금까지 **{n}권**":
    "**{n}** so far",
  "남의 등급 {n}종 섞여 있습니다":
    "{n} titles from other levels are mixed in",
  "✓ 이 칸 다 찍었습니다 — {a}권 → {b}권으로 바꿉니다":
    "✓ This slot is done — changing {a} to {b}",
  "한 권도 안 찍은 채로 누르면 이 칸을 **빈 칸으로** 바꿉니다 — 칸을 비웠을 때만 쓰세요.":
    "Pressing this with nothing scanned marks the slot **empty** — only use it when you really have emptied it.",
  "④ {lv}등급 장서와 대조":
    "④ Cross-check against the level-{lv} catalog",
  "장서 {a}권 · 이 등급 칸에서 찍힘 {b}권":
    "{a} in catalog · {b} scanned in this level's slots",
  "→ 다 맞습니다":
    "→ everything matches",
  "→ {n}권 모자랍니다":
    "→ {n} short",
  "→ {n}권 더 나왔습니다":
    "→ {n} more than expected",
  "이 등급 칸에서 안 나온 책 {n}종":
    "{n} titles that did not turn up in this level's slots",
  "장서 {a}권 · 여기 {b}권":
    "{a} in catalog · {b} here",
  "대출 {n}권":
    "{n} on loan",
  "이 등급 칸에 꽂혀 있는 남의 등급 책 {n}종":
    "{n} titles from other levels shelved in this level's slots",
  "찍힌 권수가 장서보다 많은 책 {n}종":
    "{n} titles where more were scanned than the catalog holds",
  "장서 {a}권 → 찍힘 {b}권":
    "catalog {a} → scanned {b}",
  "▶ {lv}등급 정리 시작 — 시리즈 · 알파벳 · 렉사일 순으로":
    "▶ Start tidying level {lv} — by series, alphabet, then Lexile",
  "{k}종 · {c}권":
    "{k} titles · {c} copies",
  "— 대출 중 {out}권 · **책장에 있어야 할 {on}권**":
    "— {out} on loan · **{on} should be on the shelf**",
  "찍음 {k}종 · {c}권":
    "Scanned {k} titles · {c} copies",
  "기록 {k}종 · {c}권":
    "On record {k} titles · {c} copies",
  "먼저 손봐야 합니다 — {n}개":
    "Needs fixing first — {n}",
  "같은 ISBN이 등급별로 {n}줄 — 어느 쪽인지 골라주세요":
    "The same ISBN has {n} rows, one per level — pick which one",
  "기록에 있는데 안 나왔습니다 — {n}종":
    "On record but did not turn up — {n} titles",
  "📕 대출 중 {n}권":
    "📕 {n} on loan",
  "나왔는데 기록보다 많습니다 — {n}종":
    "Turned up more than the record says — {n} titles",
  "맞는 책 {n}종. 다 찍으셨으면 아래에서 이 칸의 기록을 바꿉니다.":
    "{n} titles match. Once everything is scanned, update this slot's record below.",
  "실제 책장과 권수가 다르면 여기서 고칩니다. **−1권**은 두 번 찍힌 것, **빼기**는 애초에 이 칸 책이 아니었던 것입니다. 어디서부터 어긋났는지 모르겠으면 **✅ 대조 검사**로 칸을 비우고 다시 찍어 맞춰 보세요.":
    "Where the count differs from the actual shelf, fix it here. **−1** is for a double scan; **Remove** is for a book that never belonged in this slot. If you cannot tell where things went wrong, use **✅ Cross-check**: empty the slot and scan it again.",
  "새 버전 v{next} 이 나왔습니다 — 이 화면은 v{now} 입니다.":
    "Version v{next} is out — this screen is v{now}.",
  "{zone} 칸에 적은 책 {n}권":
    "{n} books recorded in slot {zone}",
  "📥 인쇄 대기 {n}장 — 칸을 다 돌고 「인쇄 기록」에서 한꺼번에 뽑으세요.":
    "📥 {n} labels waiting to print — finish the slots, then print them together from «Print records».",
  "이 칸에서 {n}권째":
    "copy {n} in this slot",
  "지금 {lv}등급":
    "currently level {lv}",
  "지금 등급 없음":
    "no level yet",
  "🧮 장서를 찾은 {n}권으로":
    "🧮 Set the catalog to the {n} found",
  "📗 이 권만 {lv}등급으로 떼기":
    "📗 Split just this copy off to level {lv}",
  "{lv}등급 줄로 한 권 옮깁니다 — 없으면 새로 만듭니다":
    "Moves one copy to the level-{lv} row — creating it if there is none",
  "✏️ 이 줄 전체를 {lv}등급으로":
    "✏️ Move this whole row to level {lv}",
  "{n}권 모두 — 등급이 잘못 적혀 있던 경우":
    "All {n} copies — for when the level was recorded wrongly",
  "📗 이 권만 {lv}등급으로":
    "📗 Just this copy to level {lv}",
  "{n}권 모두":
    "All {n} copies",
  "✂ {n}줄로 따로 떼기":
    "✂ Split into {n} rows",
  "장서에 {a}권 · 지금까지 {b}권 찾음":
    "{a} in the catalog · {b} found so far",
  "({zone}에 {n}권)":
    "({n} in {zone})",
  "({zone}에 있던 책)":
    "(was in {zone})",
  "**{zones}** 에 세어 둔 책입니다. 지금 손에 든 이 책이 **거기서 옮겨 온 그 책**인가요, **기록에 없던 또 한 권**인가요?":
    "This book is counted in **{zones}**. Is the one in your hand **that same book, moved here**, or **another copy that was never on record**?",
  "그 칸에 가 보니 없다면 「여기로 옮겨 왔습니다」입니다 — 그 칸 기록에서 한 권을 빼고 이 칸에 적습니다(장서 권수는 그대로).":
    "If it is not in that slot when you go and look, it is «moved here» — one copy comes off that slot's record and goes on this one (the catalog count stays).",
  "적힌 권수는 이미 다 찾았습니다. 지금 손에 든 책이 **아까 그 책**인가요, **기록에 없던 한 권**인가요?":
    "Every recorded copy has already been found. Is the book in your hand **the one from before**, or **a copy that was never on record**?",
  "📍 {zone} 에서 여기로 옮겨 왔습니다":
    "📍 Moved here from {zone}",
  "{zone} 기록에서 한 권 빼고 이 칸에 적습니다 · 장서 권수는 그대로":
    "Takes one copy off {zone}'s record and puts it on this slot · the catalog count stays",
  "➕ 장서추가 — {n}권째":
    "➕ Add to catalog — copy {n}",
  "장서도 {a} → {b}권":
    "Catalog goes {a} → {b}",
  "표지에서 읽은 제목: **{title}** — 위 칸에 넣어 두었습니다. 아래 후보 중 손에 든 책이 있으면 누르세요(ISBN까지 함께 들어갑니다).":
    "Title read from the cover: **{title}** — it has been put in the field above. If the book in your hand is among the candidates below, press it (the ISBN comes with it).",
  "새로 등록 **{n}권**":
    "**{n}** newly registered",
  "책장에 없던 한 권 더함 **{n}권**":
    "**{n}** added that were not on the shelf record",
  "보유 {n}권":
    "{n} held",
  "표지에 적힌 ISBN 13자리":
    "The 13-digit ISBN printed on the cover",
  "ISBN 칸을 비워 두면 **도서관 라벨 번호(GIA-B-…)**를 새로 발급해 그 번호로 바코드를 만듭니다 — 붙이고 나면 그 책도 스캐너로 한 번에 찾힙니다. ISBN을 함께 적으면 그 번호가 라벨에 들어가고, 제목은 적으신 것을 씁니다(조회처 제목보다 표지가 맞습니다).":
    "Leave the ISBN field empty and a **library label number (GIA-B-…)** is issued and turned into a barcode — once it is on, the scanner finds that book in one go. Enter an ISBN and that number goes on the label, while the title used is the one you typed (the cover beats the lookup sources).",
  "다른 조회처는 「{titles}」라고 답했습니다 — 등록한 뒤 한 번 눌러 바꿀 수 있습니다.":
    "Other sources answered «{titles}» — you can switch to one with a press after registering.",
  "조회처가 이 번호를 모릅니다. 아래에 **표지의 제목**을 적으면 그 제목으로 등록합니다.":
    "The lookup sources do not know this number. Type **the title on the cover** below and it is registered under that title.",
  "장서에 적힌 보유 **{n}권**":
    "**{n}** held per the catalog",
  "책장등록에서 찍힌 **{n}권**":
    "**{n}** scanned in shelf recording",
  "대출 중 {n}권":
    "{n} on loan",
  "라벨에 찍히는 번호는 **{code}** 입니다":
    "The number printed on the label is **{code}**",
  "없음":
    "none",
  "(도서관 라벨 번호). 뽑아서 붙이는 일이고, 기록은 바뀌지 않습니다 — ISBN 은 이미 적혀 있습니다.":
    "(library label number). This only prints and sticks; no record changes — the ISBN is already on file.",
  "(ISBN). 뽑아서 붙이는 일이고, 기록은 바뀌지 않습니다.":
    "(ISBN). This only prints and sticks; no record changes.",
  "장서에는 {a}권인데 책장에서는 {b}권만 찍혔습니다 — **{left}권이 아직 책장 밖**에 있다는 뜻이고, 손에 든 이 책이 그 한 권입니다. **장서 숫자는 그대로 둡니다**(여기서 늘리면 없는 책이 한 권 생깁니다).":
    "The catalog says {a} but only {b} were scanned on the shelves — meaning **{left} are still off the shelf**, and the book in your hand is one of them. **The catalog number is left alone** (raising it here would invent a book that does not exist).",
  "넘기면 **책장 미등록 장서**에 적어 둡니다. 라벨을 붙여 책장에 꽂은 뒤":
    "Skip and it is noted under **Catalog not yet shelved**. After the label is on and the book is shelved,",
  "장서 {n}권 그대로 — **책장 미등록 장서**에 적어 둡니다":
    "Catalog stays at {n} — noted under **Catalog not yet shelved**",
  "아니요 — 이것 말고 **또 한 권**이 더 있습니다":
    "No — there is **another copy** besides this one",
  "장서를 {a}권 → {b}권으로":
    "Take the catalog from {a} to {b}",
  "아직 모르겠습니다 — **넘기기** (자리에 가서 확인하고 다시 찍으면 됩니다)":
    "Not sure yet — **skip** (go and check the slot, then scan it again)",
  "등록되어 있지 않던 번호입니다 — 바꾼 것이 아니라 **새로 등록**했습니다.":
    "This number was not on file — nothing was changed; it was **newly registered**.",
  "— {src}에서 가져온 제목입니다":
    "— title taken from {src}",
  "남은 권수는 상품코드 {code} 줄에 **{n}권** 그대로 있습니다 — 같은 번호를 또 찍으면 또 한 권이 떨어져 나옵니다.":
    "The remaining copies stay on product-code row {code} — **{n} of them**. Scanning the same number again splits off another copy.",
  "되돌리기와 다시 등록을 **한 번에** 합니다. 되돌릴 수 없는 경우(그 뒤에 같은 상품코드를 또 재등록한 경우)에는 아무것도 바꾸지 않고 그 이유를 말합니다. 잘못 담긴 라벨은 모아뽑기에서 함께 빼 드립니다.":
    "Undoes and re-registers **in one step**. Where it cannot be undone (because the same product code was re-registered again afterwards) nothing is changed and the reason is given. Labels added by mistake are removed from the print batch at the same time.",
  "라벨 뽑기 ({n}장)":
    "Print labels ({n})",
  "(상품코드도 함께 뗍니다)":
    "(the product codes come off too)",
  "{n}장":
    "{n} sheets",
  "뽑은 기록 {n}묶음":
    "{n} printed batches",
  "재등록한 기록 {n}건":
    "{n} re-registrations",
  "책 {n}권을 칸에 나눠 담는 중…":
    "Dividing {n} books into slots…",
  "지금 쓰는 임시구역을 그대로 정리 대상으로":
    "Use the temporary zones as they are",
  "({n}칸)":
    "({n} slots)",
  "칸 폭 {n}cm":
    "Slot width {n}cm",
  "이 등급 책을 꽂는 데 **{need}cm** 가 들고, 칸은 모두 **{have}cm** 입니다":
    "Shelving this level takes **{need}cm**, and the slots come to **{have}cm** in all",
  "재어 둔 칸 {z}개로 종이 두께를 바로잡았습니다(가늠 × {f}).":
    "Calibrated the paper thickness against {z} measured slots (estimate × {f}).",
  "**쪽수를 모르는 책 {n}권**은 {mm}mm 로 봅니다 — 「쪽수 채우기」를 돌리면 그만큼 정확해집니다.":
    "**{n} books with no page count** are taken as {mm}mm — running «Fill in page counts» makes this that much more accurate.",
  "먼저 손보면 좋은 것:":
    "Worth fixing first:",
  "대상 연령이 비어 있는 책 **{n}권**":
    "**{n} books** with no audience age",
  "분류가 ‘기타’거나 비어 있는 책 **{n}권**":
    "**{n} books** whose category is ‘other’ or blank",
  ". 장서관리 화면에서 채우면 훨씬 깔끔하게 나뉩니다. 지금 확정해도 이 책들은 맨 뒤 칸에 모입니다.":
    ". Filling these in on the Catalog screen divides them much more cleanly. Confirm now and these books simply gather in the last slot.",
  "용량이 정해지지 않은 칸이 {n}개 있습니다 — 그런 칸은 ‘얼마든지 들어감’으로 계산합니다. 임시구역에 책을 다 등록한 뒤 구역 관리에서 ‘등록된 권수를 용량으로’를 누르면 실제 수용량이 잡힙니다.":
    "{n} slots have no capacity set — those are treated as ‘holds any number’. Once every book in the temporary zones is recorded, press ‘Use recorded count as capacity’ in Manage zones and the real capacity is set.",
  "{a} / {b} 칸":
    "slot {a} / {b}",
  "다 하면 **{n}권**":
    "**{n} books** when done",
  "(약 {n}cm)":
    "(about {n}cm)",
  "그대로 {a} · 빼낼 {b} · 채울 {c}":
    "stay {a} · out {b} · in {c}",
  "세트 {n}권":
    "{n} in sets",
  "① 그대로 둘 책 {n}권 — 건드리지 마세요":
    "① {n} books that stay — leave them alone",
  "② 빼 둔 책부터 꽂습니다 {n}권 — 앞 칸에서 이미 뺀 책(가지 않아도 됩니다)":
    "② Shelve the books you set aside first, {n} of them — already pulled from earlier slots (no walking needed)",
  "③ 칸마다 한 번만 갑니다 — 칸 {z}곳 · 보낼 {out}권 · 받을 {inn}권":
    "③ One trip per slot — {z} slots · {out} out · {inn} in",
  "맞교환 {n}권":
    "{n} swapped",
  "보낼 {out} · 받을 {inn}":
    "out {out} · in {inn}",
  "④ 자리를 모르는 책 {n}권 — 찾아서 꽂아야 합니다":
    "④ {n} books with no known location — these have to be found and shelved",
  "세트로 묶을 책 {n}권":
    "{n} books to group as a set",
  "이 칸 정원을 {n}권으로 적고 다음 칸으로":
    "Record this slot's capacity as {n} and move on",
  "모두 **{n}권** · {steps}단계":
    "**{n} books** in all · {steps} steps",
  "↔ 맞교환 {n}":
    "↔ {n} swaps",
  "→ 생긴 자리로 {n}":
    "→ {n} into freed space",
  "사람이 정한 자리 **{n}권** 이 계획 위에 덮여 있습니다.":
    "**{n} books** placed by hand override this plan.",
  "가서 보고 정해 주세요 — {zone} 에 {n}권이 더 들어가나요?":
    "Go and look, then decide — will {n} more fit in {zone}?",
  "이 칸":
    "this slot",
  "✓ {n}권 다 들어갑니다":
    "✓ All {n} fit",
  "**안 들어간다면 2안** —":
    "**If they do not fit, plan B** —",
  "{zone} 에 {n}권":
    "{n} to {zone}",
  "(그래도 {n}권은 갈 곳이 없습니다)":
    "({n} still have nowhere to go)",
  "+ {lv}등급 칸 하나 더 만들기":
    "+ Add one more level-{lv} slot",
  "…그리고 {n}권 더":
    "…and {n} more",
  "남은 {n}단계 더 보기":
    "Show the remaining {n} steps",
  "아직 갈 곳이 없는 책 {n}권":
    "{n} books still with nowhere to go",
  "**여유가 남은 칸으로 보낼 수 있습니다** —":
    "**They can go to slots with room** —",
  "({n}권은 그래도 남습니다)":
    "({n} still remain)",
  "**책이 가장 덜 움직이는 칸부터** 세워 두었습니다. 한 칸만 골라 끝내고 싶을 때 보세요.":
    "Ordered **from the slot that moves the fewest books**. Use this when you want to finish just one slot.",
  "**{n}권**만 움직이면 됩니다":
    "Only **{n} books** to move",
  "가져올 {n}권":
    "{n} to bring in",
  "먼저 빼냅니다 — 이 칸에 있지만 다른 칸으로 갈 책 {n}권":
    "Take out first — {n} books in this slot that belong elsewhere",
  "그다음 가져옵니다 — 이 칸에 와야 하는 책 {n}권 (꽂을 차례대로)":
    "Then bring in — {n} books that belong in this slot (in shelving order)",
  "{n}쪽":
    "{n} pages",
  "나머지 {n}권은 이미 이 칸이 제자리입니다 — 그대로 두세요.":
    "The other {n} are already in their place here — leave them.",
  "세트로 묶을 단서가 없는 책 {n}권 — 🤖 AI 로 채우기 · 눈에 띌 때 묶기":
    "{n} books with nothing to group them by — 🤖 fill with AI · group them as you notice them",
  "제안 {n}권":
    "{n} suggested",
  "제외 {n}권":
    "{n} excluded",
  "아직 {n}권 남음":
    "{n} still to go",
  "✓ {n}권 적용":
    "✓ Apply {n}",
  "렉사일 **{n}L**":
    "Lexile **{n}L**",
  "고른 {n}권에 적기":
    "Apply to the {n} selected",
  "같은 책이 **두 줄로 등록**되어 있으면(전체 68종) 이제 같은 칸으로 묶이기는 하지만, 권수가 갈라져 있어 셈이 어긋납니다 —":
    "Where one book is **registered as two rows** (68 titles in all) they now group into the same slot, but the copies are split between the rows, so the counts do not add up —",
  "확정해야 **이동 목록 인쇄**가 채워집니다(지금 비어 있는 이유입니다). 위의 정리 순서는 확정하지 않아도 보입니다.":
    "**Print move list** only fills up once the plan is confirmed (which is why it is empty now). The tidy order above shows without confirming.",
  "(확정 뒤)":
    "(after confirming)",
  "{lv}등급 칸이 **정식**이 됩니다 — **구역 라벨**을 뽑아 코팅해 붙일 수 있습니다":
    "Level-{lv} slots become **permanent** — you can print **zone labels**, laminate them and stick them on",
  "칸마다 **정리를 마친 시각**이 남습니다":
    "Each slot keeps **the time its tidying finished**",
  "{lv}등급 {total}권 중 **{placed}권**이 이 등급 칸에 찍혀 있습니다":
    "**{placed}** of {total} level-{lv} books are scanned into this level's slots",
  "아직 {n}권이 밖에 있습니다":
    "{n} are still out",
  "✓ {lv}등급 정식 책장으로 등록":
    "✓ Register level {lv} as permanent shelving",
  "🖨 {lv}등급 구역 라벨 인쇄":
    "🖨 Print level-{lv} zone labels",
  "‘{q}’ 검색 결과 — 누르면 대출 예정 목록에 담깁니다":
    "Results for ‘{q}’ — press one to add it to the checkout list",
  "🔁 예전에 빌림 — {day}":
    "🔁 Borrowed before — {day}",
  "제목이나 지은이를 치면 그 책이 **어느 칸**에 있는지 알려줍니다.":
    "Type a title or an author and it tells you **which slot** the book is in.",
  "이 책들은 아직 구역이 정해지지 않았습니다. ‘구역 배정’ 탭에서 자리를 정해주세요.":
    "These books have no zone yet. Give them a place on the ‘Assign zones’ tab.",
  "카드 목록을 읽지 못했습니다 — {err}. 운영앱 쪽 표가 아직 안 만들어졌을 수 있습니다(몇 분 뒤 다시 열어보세요).":
    "The card list could not be read — {err}. The table on the admin-app side may not exist yet (try again in a few minutes).",
  "표지 없는 책만 ({n})":
    "Only books with no cover ({n})",
  "🏷 라벨 필요 {kinds}종 · {sheets}장 인쇄":
    "🏷 {kinds} need labels · print {sheets}",
  "바로 인쇄 ({n}장)":
    "Print now ({n})",
  "⚠ 판매코드로 등록된 책 {n}종":
    "⚠ {n} titles registered under a sales code",
  "총 {n}권 · 이 번호로는 시리즈 몇 권째인지 알 수 없습니다":
    "{n} copies in all · this number cannot say which volume of the series it is",
  "📥 모아둔 라벨 {n}장":
    "📥 {n} labels in the batch",
  "A4 한 장에 27장 — 한 장 넘게 찼습니다":
    "27 per A4 sheet — more than a full sheet now",
  "A4 한 장에 27장 — {n}장 더 모으면 한 장":
    "27 per A4 sheet — {n} more makes a full sheet",
  "모아둔 {n}장 인쇄":
    "Print the {n} collected",
  "같은 책 {n}권 —":
    "{n} copies of this book —",
  "{a} / {b}권":
    "{a} / {b}",
  "책장등록은 칸을 하나씩 비워 가며 **책을 한 권씩 손에 들고 찍은** 기록입니다. 그러니 장서에 있는데 책장등록에 안 나온 책은 **지금 책장 밖에 있는 책**입니다 — 없어진 것이 아니라 상품코드 더미, 라벨 없는 더미, 책상 위에 있습니다. 이 종이는 그 책들을 찾아 **재등록 · 라벨 뽑기** 화면에서 마무리하기 위한 목록입니다. 한 권 끝낼 때마다 왼쪽 네모에 표시하세요.":
    "Shelf recording is a record of emptying one slot at a time and **scanning every book by hand**. So a book the catalog holds but shelf recording does not is **a book currently off the shelf** — not lost, but in the product-code pile, the unlabelled pile, or on the desk. This sheet is the list for finding those books and finishing them on the **Re-register · Print labels** screen. Tick the box on the left as you finish each one.",
  "책장등록에 **한 번도** 나오지 않았습니다. 더미에서 찾아야 합니다 — 「상품코드」 표가 붙은 책은 상품코드 더미에 있습니다.":
    "**Never** turned up in shelf recording. These have to be found in the piles — a book marked «product code» is in the product-code pile.",
  "장서 권수보다 책장에서 적게 찍혔습니다. 적힌 칸에 가서 **실제로 몇 권인지** 세어 보세요 — 기록이 부풀어 있던 것일 수도 있고, 정말 한 권이 밖에 있는 것일 수도 있습니다.":
    "Fewer were scanned on the shelves than the catalog holds. Go to the slot on record and count **how many are actually there** — the record may have been inflated, or a copy may really be off the shelf.",
  "이 숫자는 **{day} 기준**입니다. 재등록을 하면 그만큼 줄어듭니다. 정리가 끝나고 이 책들을 책장에 꽂아 찍고 나면, 그때는 책장등록이 곧 장서가 됩니다.":
    "These figures are **as of {day}**. Re-registering brings them down. Once the tidying is done and these books are shelved and scanned, the shelf record and the catalog become one and the same.",
  "**{card}**를 접이식으로 뽑으려면 한 조각이 {mm}mm인데 {paper} {dir}는 그만큼 길지 않습니다. 용지를 **{turn}**로 돌리거나 A3로 바꿔주세요.":
    "Printing **{card}** as a fold-over needs {mm}mm per piece, and {paper} {dir} is not that long. Turn the paper to **{turn}**, or switch to A3.",
  "인쇄 설정에서 **배율 100%(실제 크기)**, **여백 없음**, 그리고 **「배경 그래픽」**을 켜주세요. 두꺼운 종이(160~200g)가 알맞습니다. 용지는 **{paper}**로 맞춰져 있습니다(한 장에 {per}명분).":
    "In the print dialog set **100% scale (actual size)**, **no margins**, and turn on **«Background graphics»**. Heavy stock (160–200 gsm) works well. The paper is set to **{paper}** ({per} cards per sheet).",
  "종이를 아끼려고 일부 조각은 **옆으로 눕혀** 넣었습니다. 자르는 선은 모두 직선이라 재단기로 그대로 자르실 수 있습니다.":
    "To save paper, some pieces are laid **on their side**. Every cut line is straight, so a guillotine can take them as they are.",
  "자른 뒤 **가운데 표시선을 따라 반으로 접고**(뒷면이 뒤로 가게), 접힌 쪽 모서리 두 곳을 **점선을 따라 둥글게** 잘라주세요. 접은 상태에서 두 겹을 함께 잘라야 앞뒤가 똑같이 둥글어집니다. 그다음 코팅하면 네 모서리가 모두 둥근 앞뒤 남색 카드가 됩니다.":
    "After cutting, **fold in half along the centre mark** (back facing out), then **round the two corners on the folded side along the dotted line**. Cut both layers together while folded so the front and back round identically. Laminate after that and you have a navy card, rounded on all four corners, front and back.",
  "앞면 시트와 뒷면 시트가 번갈아 나옵니다. 양면 인쇄를 쓰시거나, 앞면을 뽑은 종이를 뒤집어 다시 넣어 뒷면을 뽑으세요.":
    "Front sheets and back sheets come out alternately. Use duplex printing, or put the printed front sheets back in face-down and print the backs.",
  "이 책들은 **상품코드**로 등록되어 있습니다. 상품코드는 시리즈 전체가 같은 번호를 쓰므로 책 한 권을 가리키지 못합니다. 책을 손에 들고 **이 줄이 정말 같은 책 몇 권인지** 확인해 주세요. 다른 책이 섞여 있으면 오른쪽에 적어 두고, 돌아와서 장서 관리의 **따로 떼기**로 나누면 각각 도서관 라벨이 발급됩니다.":
    "These books are registered under a **product code**. A whole series shares one product code, so it cannot point at a single book. With the books in hand, check **how many copies of the same book this row really is**. If other books are mixed in, note them on the right, then come back and split them with **Split off** in Catalog — each one is issued its own library label.",
  "**자리는 책 한 줄에 하나만 적혀 있습니다.** 권마다 자리를 적는 칸이 아직 없어서, **「2-1 · 12권」은 12권이 모두 2-1에 있다는 뜻이 아닙니다.** 이 줄에 적어 둔 자리가 2-1이고 기록상 권수가 12라는 뜻입니다. 특히 상품코드 줄은 애초에 서로 다른 책이 한 줄로 합쳐진 것일 수 있어, 여러 칸에 흩어져 있는 편이 보통입니다.":
    "**A row holds only one location.** There is no field yet for a location per copy, so **«2-1 · 12 copies» does not mean all 12 are in 2-1.** It means the location recorded on this row is 2-1 and the recorded count is 12. Product-code rows especially may have merged different books into one row to begin with, so being scattered across slots is the norm.",
  "여러 권인 줄에는 **⚠** 를 붙여 두었습니다. 그 칸에서 **실제로 찾은 권수**를 적어 주세요 — 기록과 다른 것이 곧 고쳐야 할 내용입니다.":
    "Rows with several copies are marked **⚠**. Write down **how many you actually find** in that slot — whatever differs from the record is what needs fixing.",
  "인쇄 설정에서 **배율 100%**, **여백 없음**으로 맞춰주세요. 책 뒤표지 안쪽이나 책등 아래에 붙이면 스캐너로 바로 읽힙니다.":
    "In the print dialog set **100% scale** and **no margins**. Stuck inside the back cover or low on the spine, a label reads straight away on the scanner.",
  "라벨이 **맞붙어** 나옵니다. 이웃한 두 장이 선 하나를 함께 쓰므로, 그 선을 **한 번만 자르면 두 장이 동시에 떨어집니다**. 긴 선부터 쭉 자른 뒤 세로로 자르면 가장 빠릅니다.":
    "The labels come out **edge to edge**. Neighbouring labels share a cut line, so **one cut frees both at once**. Running the long lines first, then cutting across, is quickest.",
  "라벨에는 **책 이름**만 찍습니다. 책장 자리는 아직 임시라 계속 바뀌는데, 라벨은 책에 붙어서 몇 년을 갑니다 — 오늘 찍은 자리가 다음 달이면 거짓말이 됩니다. **고른 순서 그대로** 나오니, 책을 빼 놓은 순서와 맞춰 붙이시면 됩니다.":
    "A label carries **the book's name** only. Shelf locations are still temporary and keep changing, while a label stays on the book for years — a location printed today becomes a lie next month. They come out **in the order you picked them**, so stick them in the order the books are stacked.",
  "인쇄 설정에서 **배율 100%**, **여백 없음**으로 맞춰주세요. **코팅해서** 책장 칸 앞면이나 선반 모서리에 붙이면 오래 씁니다. 위쪽 색 띠는 **라벨 등급 색**이고, 가운데 줄은 **그 칸에 꽂히는 범위**(세트 이름·작가 이름 순)입니다 — 학생이 책을 찾고, 반납된 책을 제자리에 꽂을 때 그 줄을 봅니다. 아래 바코드를 찍고 책을 이어서 찍으면 그 칸으로 한꺼번에 배정됩니다.":
    "In the print dialog set **100% scale** and **no margins**. **Laminate** them and stick them on the front of the slot or the shelf edge and they last. The colour band at the top is the **label level colour**; the middle line is **the range that belongs in that slot** (by set name and author name) — that is the line a student reads to find a book, and the one you read when shelving a return. Scan the barcode below, then scan books one after another, and they are all assigned to that slot.",
  "범위는 **확정한 정리 계획**에서 가져옵니다(확정 전이면 지금 꽂혀 있는 책 기준) — 정리를 끝내고 확정한 뒤에 뽑으시면 그대로 맞습니다.":
    "The range comes from **the confirmed tidy plan** (before confirmation, from the books currently shelved) — print these after the tidying is done and confirmed and the range will be right.",
  "여기서 바꾸면 **실제 대출 규칙도 함께 바뀝니다.** 이미 뽑아 둔 카드에는 옛 숫자가 그대로 적혀 있으니, 크게 바꾸실 때는 카드를 다시 뽑는 편이 낫습니다.":
    "Changing it here **changes the actual lending rules too.** Cards already printed still show the old numbers, so for a large change it is better to reprint them.",
  "인쇄를 마치셨으면 **발급 기록**을 남겨 주세요 — 누가 카드를 받았는지, 잃어버려 다시 뽑았는지가 남습니다.":
    "Once printing is done, leave an **issue record** — it keeps who received a card, and whether it was reprinted after a loss.",
  "이 목록에서 **{n}명**은 아직 사진이 없어 카드를 뽑을 수 없습니다. 운영앱 학생 관리에서 사진을 올리면 바로 뽑을 수 있고, 사진 칸의 **+사진**을 눌러 도서관에서 직접 올릴 수도 있습니다.":
    "**{n} students** on this list have no photo yet, so no card can be printed for them. Upload a photo in the admin app's student management and it prints right away, or press **+Photo** in the photo column to upload it here in the library.",
  "한글":
    "Korean",
  "영어+한글":
    "English + Korean",
  "영어만":
    "English only",
  "라벨이나 도서카드 인쇄 화면을 열면 그 목록이 여기 자동으로 남습니다. 지금 쓰는 컴퓨터에 프린터가 없으면, **프린터가 있는 컴퓨터에서 도서관 앱에 로그인해** 여기서 인쇄를 누르세요. 같은 종이가 그대로 나옵니다.":
    "Opening a label or library-card print screen records that list here automatically. If this computer has no printer, **sign in to the library app on a computer that does** and press print here. The same sheet comes out.",
  "아직 기록이 없습니다. 장서 관리에서 책을 골라 **라벨 인쇄**를 누르거나, 도서카드 인쇄 화면을 한 번 열면 여기에 남습니다.":
    "No records yet. Pick books in Catalog and press **Print labels**, or open the library-card print screen once, and they appear here.",
  "아직 구역이 없습니다. 관리 메뉴의 **구역 관리**에서 먼저 만들고 책장 라벨을 인쇄해 붙여주세요.":
    "No zones yet. Create them in **Manage zones** under the admin menu, then print the shelf labels and stick them on.",
  "아직 배치도가 없습니다.":
    "No floor plan yet.",
  "관리 메뉴 → **구역 관리**에서 구역을 만들고 끌어다 놓으면 여기에 도서관 모양이 그려집니다.":
    "Create zones in admin menu → **Manage zones** and drag them into place, and the shape of the library is drawn here.",
  "번호의 **연도 자리**만 다릅니다 — 점검용은 **9000**, 교직원은 **9001**. 9000년도 입학생은 없으니 학생 번호와 영원히 겹치지 않고, 번호만 봐도 사람 카드가 아닌 걸 알 수 있습니다. 번호는 직접 적지 않고 다음 번호로 이어 붙습니다.":
    "Only the **year part** of the number differs — **9000** for test cards, **9001** for staff. Nobody enrols in the year 9000, so these can never collide with a student number, and the number alone tells you it is not a pupil's card. You do not type the number; it continues from the last one.",
  "만든 카드는 **도서카드 인쇄** 화면에 함께 나옵니다 — 거기서 뽑아 코팅하면 됩니다.":
    "Cards you create appear on the **Print library cards** screen — print and laminate them there.",
  "그런 책은 없습니다. 글자를 조금만 쳐보세요 — 「해리」처럼 앞부분만 쳐도 찾습니다.":
    "No such book. Try typing just a little — even the start of a word, like «harry», finds it.",
  "칸":
    "slot",
  "지금 책에 붙어 있는 색 라벨과, 그 라벨 책이 **몇 칸에 들어 있는지**를 적으면 **2-1 … 6-6** 처럼 칸마다 임시구역을 만들어 둡니다. 한 칸씩 책을 빼서 등록할 때 그 칸을 고르기만 하면 됩니다. 지금은 임시라 나중에 자유롭게 바꾸거나 지울 수 있습니다.":
    "Enter the colour labels now on the books and **how many slots each label fills**, and a temporary zone is created for every slot — **2-1 … 6-6**. Then, emptying and recording one slot at a time, you only have to pick that slot. These are temporary, so they can be changed or deleted freely later.",
  "학기 목록을 읽지 못했습니다 — 운영앱에 등록된 학기를 따라가는데, 아직 연결되지 않았거나 등록된 학기가 없습니다. 월별·연도별은 그대로 쓸 수 있습니다.":
    "The term list could not be read — it follows the terms registered in the admin app, which is either not connected yet or has no terms. Monthly and yearly views still work.",
  "최근 반년 안에 들어온 책은 뺐습니다 — 아직 기회가 없었으니까요. 책장 자리가 모자랄 때 먼저 들여다볼 목록입니다.":
    "Books added within the last six months are left out — they have not had their chance yet. This is the list to look at first when shelf space runs short.",
  "이 계정은 운영앱(GIA 운영)의 계정 관리에서 **승인** 상태가 아닙니다.":
    "This account is not **approved** in account management in the admin app (GIA Ops).",
  "도서관 공용 계정이라면 관리자에게 승인 처리를 요청하시고, 개인 교직원 계정이라면 운영앱에서 계정 승인을 먼저 받아주세요.":
    "For the library's shared account, ask an administrator to approve it; for a personal staff account, get the account approved in the admin app first.",
  "장서에는 있다고 적혀 있는데 **책장등록에서 나오지 않은** 책들입니다. 책장등록은 칸을 하나씩 비워 가며 한 권씩 손에 들고 찍은 기록이라, 거기 없는 책은 지금 **책장 밖에 있는 책**입니다 — 없어진 것이 아니라 더미나 책상 위에 있습니다.":
    "Books the catalog says are held but that **did not turn up in shelf recording**. Shelf recording is a record of emptying one slot at a time and scanning every book by hand, so a book missing from it is **a book currently off the shelf** — not lost, but in a pile or on the desk.",
  "재등록 화면에서 「라벨 담고 넘기기」를 누른 책은 **맨 위**로 올라옵니다. 책을 꽂은 다음 여기서 칸과 권수를 고르면 그 자리에서 책장등록이 됩니다 — 「자리 등록」 화면을 다시 열지 않아도 됩니다.":
    "A book you sent on with «Add label and skip» on the re-register screen rises **to the top**. Shelve it, then pick the slot and the number of copies here and it is recorded on the shelf right there — no need to open «Record locations» again.",
  "장서 권수는 등록할 때마다 올라간 숫자라 아무도 세어 본 적이 없습니다. 책장등록은 한 권씩 손에 들고 찍은 기록입니다. 그래서 둘이 다르면 **책장등록 쪽이 맞을 때가 많습니다** — 다만 지금은 상품코드 책과 라벨 없는 책을 책장에서 빼내어 두었으므로, 그 차이는 틀린 것이 아니라 **아직 책장에 없는 권수**입니다. 이 목록이 비면 그때 둘이 같아집니다.":
    "The catalog count only ever went up as books were registered; nobody has counted it. Shelf recording is a record of scanning every book by hand. So where the two differ, **the shelf record is usually the right one** — except that product-code books and unlabelled books are deliberately off the shelves right now, so the gap is not an error but **the number of copies not yet on a shelf**. When this list empties, the two will agree.",
  "ISBN 으로 조회처 네 곳(국립중앙도서관 · 카카오 · Google Books · OpenLibrary)에 **모두** 물어 제목을 다시 받아옵니다. 등록할 때는 먼저 답한 곳을 쓰는데, 수입 영어 전집은 국내 조회처가 **세트 이름**으로 등록해 두어서 여러 권이 한 제목으로 들어왔습니다. 손으로 적어 둔 제목도 여기서 함께 맞춥니다.":
    "Asks **all four** lookup sources (National Library of Korea · Kakao · Google Books · OpenLibrary) for the title again by ISBN. Registration uses whichever answers first, and for imported English sets the Korean sources list them under **the set name**, so many volumes came in under one title. Hand-typed titles are corrected here too.",
  "지금 제목이 **틀린 게 아니라 덜 적힌** 경우입니다. 조회된 제목이 지금 제목을 그대로 품고 있으면서 권 제목이 더 붙어 있습니다. 그래서 한 줄씩 볼 필요가 없습니다.":
    "Here the current title is **not wrong, just incomplete**. The looked-up title contains the current one in full and adds the volume title, so there is no need to check these row by row.",
  "손으로 적어 둔 제목이 맞을 수도 있고, 조회처가 엉뚱한 책을 준 것일 수도 있습니다. **책을 보고** 정해주세요. 바꿀 것만 골라서 눌러도 되고, 칸을 직접 고쳐 써도 됩니다.":
    "The hand-typed title may be the right one, or the lookup may have returned the wrong book. **Look at the book** and decide. Tick only the ones to change, or type over the field yourself.",
  "바꾸기 전 제목을 남겨 두었습니다. 돌리고 싶으면 그 줄의 「되돌리기」를 누르세요.":
    "The title before the change was kept. To put it back, press «Undo» on that row.",
  "제목만 바뀝니다. 권수·자리·등급은 건드리지 않습니다. 같은 ISBN 이 등급별로 여러 줄이면 그 줄들은 따로 고칩니다 — 줄을 합치거나 나누는 일은":
    "Only the title changes. Copies, locations and levels are untouched. Where one ISBN has a row per level, those rows are corrected separately — merging or splitting rows is done in",
  "겹치는 책 합치기":
    "Merge duplicate books",
  "에서 합니다.":
    ".",
  "되돌리기":
    "Undo",
  "(비어 있었음)":
    "(was empty)",
  "구역을 먼저 고르고 바코드를 주르륵 찍으세요. 책 정보는 찍는 즉시 자동으로 채워지고, 마지막에 한 번만 누르면 전부 그 구역으로 등록됩니다. **같은 책을 또 찍으면** 새로 만들지 않고 **보유 권수를 한 권 올립니다**.":
    "Pick the zone first, then scan barcodes one after another. Book details fill in the moment you scan, and one press at the end registers them all to that zone. **Scanning the same book again** does not create a new row — it **adds one to the number held**.",
  "이 중에 손에 든 책이 있나요? 고르면 ISBN·출판사·표지까지 함께 등록되고, 라벨에 그 ISBN 바코드가 찍혀 다음부터는 스캐너로 그냥 읽힙니다.":
    "Is the book in your hand one of these? Picking it registers the ISBN, publisher and cover too, and the label carries that ISBN barcode, so from then on the scanner simply reads it.",
  "같은 책인데 두 줄이 되는 건, 한 번은 **손으로 제목을 적어** 넣고 한 번은 **바코드를 찍어** 넣었기 때문입니다. 손으로 적은 줄에는 ISBN이 없어서 나중에 바코드를 찍어도 서로를 알아볼 길이 없습니다.":
    "One book ends up as two rows because it was entered once by **typing the title by hand** and once by **scanning the barcode**. The hand-typed row has no ISBN, so a later scan has no way to recognise it as the same book.",
  "묶음마다 **가지러 갈 곳**이 적혀 있습니다. 그 칸들에서 책을 모두 꺼내 와 나란히 놓고 비교한 뒤, 정말 같은 책일 때만 합쳐주세요. **제목이 같다고 같은 책은 아닙니다.** 합치면 되돌릴 수 없습니다.":
    "Each group lists **where to fetch them from**. Bring every book out of those slots, lay them side by side, compare, and merge only if they really are the same book. **The same title does not make it the same book.** A merge cannot be undone.",
  "책에 이미 붙어 있는 색 라벨을 등급별로 모아 봅니다. 등록할 때 라벨 번호를 함께 넣어두면 여기서 **몇 번부터 몇 번까지 있는지**와 **중간에 빠진 번호**가 그대로 보입니다. 빠진 번호는 잃어버린 책이거나 아직 등록하지 않은 책입니다.":
    "Gathers the colour labels already on the books, by level. Enter the label number when registering and this screen shows **which numbers you have, from first to last** and **the numbers missing in between**. A missing number is either a lost book or one not yet registered.",
  "책에 인쇄된 바코드를 찍으세요. 상품코드로 등록된 책이면 **표지의 ISBN**을 적는 자리가 나오고, 적으면 그 정보로 바꿔 적은 뒤 **모아뽑기**에 라벨을 담습니다. 바꾼 결과는 아래에 **전 → 후**로 펼쳐 둡니다 — 제목·권수·라벨 번호를 눈으로 대보고 다음 책을 찍으세요.":
    "Scan the barcode printed on the book. If it is registered under a product code, a field appears for **the ISBN on the cover**; enter it and the record is rewritten from that, then a label goes into **the print batch**. The result is laid out below as **before → after** — check the title, copies and label number by eye, then scan the next book.",
  "상품코드로 등록된 책 **{total}권** 중 **{done}권** 바꿨습니다":
    "**{done}** of **{total}** books registered under a product code have been changed",
  "남은 {n}권 ({rows}줄)":
    "{n} left ({rows} rows)",
  "남은 {n}권":
    "{n} left",
  "한 권 재등록할 때마다 남은 권수가 하나 줄어듭니다. 같은 상품코드에 여러 권이 묶여 있으면 그 줄은 권수만 줄고 남아 있다가, 마지막 한 권까지 바꾸면 사라집니다.":
    "Each re-registration takes one off the remaining count. Where several copies share one product code, that row stays with a smaller count until the last copy is changed, and then it disappears.",
  "번호를 치고 **등록**을 누르면 어떤 책인지 보여주고 등록할지 묻습니다(이미 등록된 책이면 그 책이 뜹니다). 번호가 아예 없으면 표지를 찍으세요 — 후보를 고르면 **ISBN까지** 붙고, 맞는 후보가 없으면 읽어낸 제목으로 등록하면서 **도서관 라벨 번호**를 발급합니다.":
    "Type the number and press **Register**: it shows you which book it is and asks whether to register it (if the book is already on record, that record comes up). With no number at all, photograph the cover — picking a match brings **the ISBN too**, and if nothing matches, the book is registered under the title read from the cover and issued a **library label number**.",
  "ISBN 바코드가 아니라 **숫자**를 보고 적으세요. 체크숫자가 맞지 않으면 받지 않습니다 — 한 자리 잘못 적힌 책은 나중에 바코드로도 제목으로도 찾히지 않습니다.":
    "Read the **digits**, not the ISBN barcode, and type those. An entry whose check digit does not add up is refused — a book recorded with one wrong digit can later be found by neither barcode nor title.",
  "— 찍은 **{code}** 과 **같은 번호**입니다(ISBN 10자리 ↔ 13자리: 앞에 978 을 붙이고 맨 끝 검사 숫자를 다시 계산합니다)":
    "— **the same number** as the **{code}** you scanned (ISBN 10 ↔ 13 digits: 978 is put in front and the final check digit recalculated)",
  "**상품코드 {code}**가 아직 이 줄에 남아 있습니다 — **일부러 남겨 둔 것**입니다. 책에는 아직 상품코드 바코드가 붙어 있으니 그 번호를 찍어도 이 줄이 걸려야 합니다. **라벨을 책에 붙인 뒤**에 떼면 번호가 하나로 정리됩니다.":
    "**Product code {code}** is still on this row — **deliberately so**. The product-code barcode is still on the book, so scanning that number must still find this row. Remove it **after the label is on the book** and the book is left with one number.",
  "라벨을 담아 두고 **「✓ 뽑았습니다 — 기록으로 넘기기」**를 누르면, 그 묶음에 든 상품코드를 그때 함께 뗍니다 — 지금은 그냥 담으시면 됩니다.":
    "Add the label to the batch, and when you press **«✓ Printed — move to records»** the product codes in that batch come off then — for now just add it.",
  "장서 {n}권이 책장에서 모두 찍혔습니다 — 손에 든 이 책은 그 위에 더 있는 한 권으로 보입니다.":
    "All {n} catalogued copies have been scanned on the shelves — the book in your hand looks like one more on top of those.",
  "책장에서 찍힌 그 {n}권은 **{where}** 에 있습니다 — **가서 같은 책이 꽂혀 있는지 보고** 눌러주세요. 거기 있으면 손에 든 이 책은 또 한 권이 맞습니다.":
    "The {n} scanned on the shelves are in **{where}** — **go and see whether the same book is there**, then press. If it is, the book in your hand really is another copy.",
  "찍힌 칸이 기록되어 있지 않습니다 — 칸을 확인할 수 없으니 「넘기기」로 두고 나중에 보시는 편이 안전합니다.":
    "No slot was recorded for the scan — with no slot to check, it is safer to choose «Skip» and look at it later.",
  "장서에 **없던 한 권**입니다":
    "This is **a copy not in the catalog**",
  "장서를 {a}권 → **{b}권**으로 하고 라벨 담기":
    "Take the catalog from {a} to **{b}** and add a label",
  "장서를 {a}권 → **{b}권**으로 하기 (라벨 없음)":
    "Take the catalog from {a} to **{b}** (no label)",
  "아니요 — **장서에 이미 있는 그 책**입니다":
    "No — this is **the copy already in the catalog**",
  "장서 {a}권 그대로 두고 라벨만 담기":
    "Leave the catalog at {a} and only add a label",
  "장서 {a}권 그대로 두고 넘어가기 (라벨 없음)":
    "Leave the catalog at {a} and move on (no label)",
  "조회처에서 이 ISBN을 찾지 못해 **원래 줄의 제목을 그대로** 두었습니다. 상품코드 한 줄에 여러 권이 묶여 있던 제목이라 이 책의 제목이 아닐 수 있습니다 — 표지를 보고 적어주세요.":
    "The lookup sources do not have this ISBN, so **the original row's title was kept**. That title covered several copies under one product code, so it may not be this book's title — read the cover and type it in.",
  "잘못 담긴 것만 빼면 됩니다 — 전부 비우지 않아도 됩니다. 복본은 권수만큼 여러 장이 들어 있는 것이 정상입니다.":
    "Just remove what was added by mistake — there is no need to empty the batch. For copies, one label per copy is correct.",
  "되돌리기는 **나중에 한 것부터**입니다. 같은 상품코드에서 한 권을 뗀 뒤 또 한 권을 떼었다면, 첫 번째를 되돌리는 것은 두 번째를 지우는 일이 되므로 거절합니다 — 조용히 어긋나게 만드는 것보다 낫습니다.":
    "Undo works **from the most recent backwards**. If one copy was split off a product code and then another, undoing the first would erase the second, so it is refused — better that than letting the records drift apart quietly.",
  "라벨에는 그 책의 ISBN이 바코드로 들어갑니다. 붙인 뒤에는 그 라벨을 찍으면 바로 그 책이 나옵니다 — 상품코드처럼 열두 권이 한꺼번에 걸리지 않습니다. 찍었던 상품코드도 함께 적어 두므로, 라벨을 붙이기 전에 그 책을 또 찍어도 같은 책으로 찾힙니다.":
    "The label carries that book's ISBN as its barcode. Once it is on, scanning the label brings up exactly that book — not twelve at once, the way a product code does. The scanned product code is recorded alongside, so scanning the book again before the label goes on still finds the same book.",
  "상품코드는 ‘책 한 권’이 아니라 ‘상품 한 줄’을 가리켜서, 전집은 열두 권이 같은 번호입니다. 어느 권인지는 표지를 보는 사람만 알 수 있어서 한 권씩 묻습니다 — 같은 번호를 또 찍으면 또 한 권이 떨어져 나옵니다.":
    "A product code points at ‘one product line’, not ‘one book’, so all twelve volumes of a set share a number. Only the person looking at the cover knows which volume it is, so you are asked one copy at a time — scanning the same number again splits off another copy.",
  "책장 한 칸을 통째로 빼서 하나씩 찍으면, 그 책들의 자리가 이 칸으로 바뀝니다. **새로 등록하는 화면이 아닙니다** — 이미 등록된 책의 자리를 고치는 화면입니다.":
    "Empty one shelf slot completely, scan the books one by one, and their location becomes this slot. **This is not the screen for adding books** — it is the screen for correcting where books already on record sit.",
  "시리즈별 정렬은 여기서 하지 않습니다. **자리가 다 잡힌 뒤** 「② 정리 계획」에서 분류해 옮길 자리를 정하고 「③ 정리 실행」으로 옮기면 됩니다. 지금은 무엇이 어디에 있는지만 사실대로 적는 단계입니다.":
    "Sorting by series does not happen here. **Once every location is settled**, decide the targets in «② Tidy plan» and move the books with «③ Run the tidy». This step only records, truthfully, what is where.",
  "아직 만든 칸이 없습니다. 「① 구역 관리」에서 칸을 먼저 만들어주세요.":
    "No slots have been created yet. Create them first in «① Manage zones».",
  "새로고침하기 전에는 새로 생긴 버튼이 안 보입니다. 찍은 것은 이미 저장돼 있으니 지금 눌러도 잃는 것은 없습니다.":
    "A newly added button does not appear until you refresh. What you scanned is already saved, so refreshing now loses nothing.",
  "등급을 먼저 고르고 책을 찍으면, **어느 칸에 꽂으면 좋은지**를 책마다 말해 줍니다. 추천은 **같은 시리즈가 있는 칸**이 우선입니다 — 아이는 시리즈로 찾고, 1권과 7권이 다른 칸에 있으면 그 시리즈는 흩어진 것입니다.":
    "Choose a level, then scan a book and it tells you, book by book, **which slot it belongs in**. A **slot that already holds the same series** comes first — children look by series, and if volumes 1 and 7 sit in different slots the series is scattered.",
  "추천은 말해 줄 뿐 넣지 않습니다. 책장 여유와 높이는 보시는 분이 압니다 — 「추천에 넣기」를 누르거나 옆 드롭다운에서 칸을 고르세요. 누르는 순간 **책장등록**이 됩니다.":
    "A recommendation only tells you; it does not file anything. You are the one who can see the room on the shelf and the height — press «Use this slot» or pick one from the dropdown beside it. The moment you press, the book is **recorded on the shelf**.",
  "이 책은 **{lv}등급**입니다 — 지금 고른 등급과 다릅니다. 그래도 넣으시려면 아래에서 칸을 고르세요.":
    "This book is **level {lv}** — not the level you selected. To file it here anyway, pick a slot below.",
  "추천 순서: ① 그 책이 이미 있는 칸(복본은 한자리에) → ② 같은 시리즈가 있는 칸 → ③ 같은 지은이가 있는 칸 → ④ 그 등급에서 가장 덜 찬 칸. 「넣기」를 누르면 그 칸에 꽂은 것으로 **책장등록**되고, 「책장 미등록 장서」 목록에서도 빠집니다.":
    "Recommendation order: ① a slot that already holds this book (copies stay together) → ② a slot with the same series → ③ a slot with the same author → ④ the emptiest slot at that level. Pressing «File» **records it on that shelf** and drops it from the «Catalog not yet shelved» list.",
  "구역 이름은 자유롭게 정하세요 — **A-1**처럼 책장·칸 번호도 되고 **그림책**처럼 분류 이름도 됩니다. 아래 배치도에서 네모를 **끌어서** 실제 도서관 모양대로 놓으면, 책을 찾을 때와 반납한 책을 제자리에 꽂을 때 그 자리가 반짝입니다.":
    "Name a zone however you like — a shelf and slot number such as **A-1**, or a category name such as **Picture books**. **Drag** the boxes on the map below into the real shape of the library, and that spot lights up when you look a book up or shelve a return.",
  "**임시**는 지금 무작정 꽂아둔 칸이고, **정식**은 정리를 마친 뒤에 쓸 칸입니다. 도서정리 계획은 정식 칸에만 책을 배정하고 임시 칸은 비웁니다. 임시 칸에 책을 다 등록했으면 **「등록된 권수를 용량으로」**를 눌러 두세요 — 그 칸에 실제로 몇 권이 들어가는지가 기록되어, 정리할 때 넘치지 않게 나눠 담습니다.":
    "**Temporary** slots are where books were put for the time being; **permanent** slots are the ones to use once the tidying is done. The tidy plan assigns books only to permanent slots and empties the temporary ones. Once every book in a temporary slot is recorded, press **«Use recorded count as capacity»** — that records how many actually fit, so the tidy divides the books without overfilling.",
  "빈 곳을 **끌면** 사각형 안의 구역이 한꺼번에 골라집니다. Shift(또는 ⌘)를 누른 채 누르면 하나씩 담거나 뺄 수 있고, 고른 것 중 하나를 끌면 **전부 같이 움직입니다**.":
    "**Drag** on empty space and every zone inside the rectangle is selected at once. Hold Shift (or ⌘) and click to add or remove one at a time; drag any selected zone and **they all move together**.",
  "권":
    "books",
  "구역 관리에서 책장 칸을 먼저 만들어 주세요. 지금 쓰고 있는 임시구역을 그대로 정리 대상으로 쓸 수 있습니다.":
    "Create the shelf slots in «Manage zones» first. The temporary zones you are using now can serve as the tidy targets as they are.",
  "지금 임시로 꽂아둔 책들을 어디로 옮길지 한 번에 계산합니다. 계획을 확정해도 책이 **지금 꽂혀 있는 자리는 바뀌지 않습니다** — 실제로 책을 옮기고 스캔했을 때 바뀝니다. 그래서 정리하는 며칠 동안에도 학생이 찾는 책의 위치를 정확히 알려줄 수 있습니다.":
    "Works out in one pass where the books now parked on temporary shelves should go. Confirming a plan **does not change where a book currently sits** — that changes when you actually move it and scan it. So even over the days the tidying takes, you can still tell a student exactly where a book is.",
  "칸에 등급이 아직 안 적혀 있습니다 — 「① 구역 관리」에서 칸마다 등급을 골라 두면 등급별로 나눠서 정리할 수 있습니다.":
    "The slots have no level recorded yet — set a level for each slot in «① Manage zones» and you can then tidy one level at a time.",
  "**{lv}등급 칸 {z}개가 모두 「다 찍음」입니다.** 지금 정리해도 됩니다 — 아직 안 꺼낸 책이 계획에서 빠질 걱정이 없습니다.":
    "**All {z} slots at level {lv} are marked «done».** You can tidy now — no book is still waiting to be scanned and at risk of being left out of the plan.",
  "**{lv}등급 칸 {z}개 중 {d}개 끝났습니다.** 남은 칸: {rest} — 그 칸들을 다 찍고 자리 등록 화면에서 **「이 칸 다 찍었습니다」**를 눌러주세요. 끝나지 않은 칸으로 계획을 세우면 아직 안 꺼낸 책들이 통째로 빠진 채 책장을 다시 짜게 됩니다.":
    "**{d} of {z} slots at level {lv} are done.** Still open: {rest} — scan those slots and press **«This slot is done»** on the «Record locations» screen. Planning from unfinished slots rebuilds the shelves with the unscanned books missing entirely.",
  "{lv}등급 책 **{n}권** ÷ 칸 **{z}개** = **한 칸 약 {each}권**씩 고르게 나눕니다. **시리즈는 한 칸에 통째로** 넣고, 남은 자리를 낱권으로 채웁니다 — 어느 칸이든 같은 만큼 여유가 남습니다.":
    "**{n} level-{lv} books** ÷ **{z} slots** = **about {each} per slot**, divided evenly. **A series goes into one slot whole**, and the space left over is filled with standalone books — every slot ends up with the same amount of room to spare.",
  "책 **{n}권** ÷ 칸 **{z}개** = **한 칸 약 {each}권**씩 고르게 나눕니다. **시리즈는 한 칸에 통째로** 넣고, 남은 자리를 낱권으로 채웁니다 — 어느 칸이든 같은 만큼 여유가 남습니다.":
    "**{n} books** ÷ **{z} slots** = **about {each} per slot**, divided evenly. **A series goes into one slot whole**, and the space left over is filled with standalone books — every slot ends up with the same amount of room to spare.",
  "이 등급에 쓸 칸이 없습니다 — 구역 관리에서 칸을 만들거나 등급을 확인해주세요.":
    "No slots available for this level — create slots in «Manage zones», or check the level.",
  "칸 정원은 아직 적혀 있지 않아서 **지금 그 칸에 꽂혀 있는 권수**를 한계로 봅니다(책장등록으로 한 권씩 센 숫자라 실제로 그만큼 들어간다는 증거입니다). 구역 관리에서 정원을 적어 두면 그 값이 우선입니다.":
    "No slot capacity is recorded yet, so **the number of books now in each slot** is taken as its limit (that number was counted book by book during shelf recording, which is proof that many fit). Record a capacity in «Manage zones» and that value wins.",
  "책장 칸 크기가 다 같으니 한 번만 재시면 됩니다 — 책이 꽂히는 **안쪽 가로 길이**를 재 주세요. 한 번 적으면 고칠 때까지 그 값을 씁니다.":
    "The slots are all the same size, so one measurement is enough — measure the **inside width** where the books stand. Once recorded, that value is used until you change it.",
  "시리즈 **{k}종 {b}권**은 같은 칸에 1권부터 차례로 붙여서 놓습니다. 시리즈에 속하지 않는 낱권은 그 뒤에 작가순으로 놓입니다.":
    "**{k} series, {b} books** go in the same slot, side by side from volume 1. Standalone books follow them, by author.",
  "칸이 모자라 **{n}권**이 자리를 못 받았습니다. 정식 구역을 더 만들거나, 칸 용량을 늘려 주세요.":
    "There are not enough slots, so **{n} books** have no place. Create more permanent zones, or raise the slot capacity.",
  "**1번 칸부터** 한 칸씩 합니다. ①그대로 둘 책 → ②빼 둔 책 꽂기 → ③칸마다 한 번만 다녀오기(보낼 책·받을 책을 함께) 차례로 하시면, 같은 칸을 두 번 가지 않고 바닥에도 책이 쌓이지 않습니다. 다 꽂으면 아래에서 **「딱 맞음 · 더 남음 · 꽉 참」**을 눌러 주세요 — 그 답이 이 칸의 **실측값**이 되어 남은 칸들의 몫이 다시 계산됩니다.":
    "Work **from slot 1**, one slot at a time: ① books that stay → ② shelve the books you set aside → ③ one trip per slot (books out and books in together). That way you never walk to a slot twice and nothing piles up on the floor. When the slot is filled, press **«Just right · Room to spare · Packed»** below — that answer becomes this slot's **measured value**, and the remaining slots are recalculated.",
  "보낼 책과 받을 책을 **그 칸 하나로 묶었습니다.** 보낼 책을 들고 가서 꽂고, 받을 책을 빼서 돌아오면 그 칸은 끝입니다 — 같은 칸을 두 번 가지 않습니다.":
    "Books out and books in are **grouped under that one slot.** Carry the outgoing books there, shelve them, pull the incoming ones and come back — that slot is done. You never walk to it twice.",
  "**적용한 기준(차례대로)**: ① **묶기** — 시리즈 → 같은 제목 → 같은 작가(2권+) → 같은 출판사(3권+) ② **세우기** — 세트는 세트 이름, 낱권은 작가 이름의 가나다·ABC 순 ③ **세트 안** — 권 번호순, 번호가 없으면 **렉사일(쉬운 책 → 어려운 책)**, 렉사일을 모르면 쪽수. 그래서 6-1부터 왼쪽 위 → 오른쪽 아래로 읽으면 늘 같은 차례이고, 반납된 책도 그 차례로 제자리를 찾습니다.":
    "**Criteria applied, in order**: ① **grouping** — series → same title → same author (2+) → same publisher (3+) ② **ordering** — sets by set name, standalone books A–Z by author ③ **within a set** — by volume number; with no number, by **Lexile (easiest first)**, and with no Lexile, by page count. So reading from 6-1, top-left to bottom-right, always gives the same order — and a returned book finds its place in that same order.",
  "다른 등급 칸의 책도 넣을 수 있습니다 — 세트 이름이 같아지면 그 등급 정리에서 같은 칸으로 모입니다. 라벨 등급은 바뀌지 않습니다.":
    "Books from other levels' slots can be added too — once they share a set name, they gather into one slot when that level is tidied. The label level itself does not change.",
  "목록에서 **몇 번째 책까지** 들어갔는지 적어 주세요. 나머지는 다음 칸으로 넘기고, 남은 칸들의 몫을 다시 계산합니다.":
    "Note **how far down the list** you got. The rest moves on to the next slot, and the remaining slots are recalculated.",
  "책장은 꽉 차 있습니다. 빈 자리가 없는 칸에 꽂으려면 먼저 한 권을 빼야 하고, 그 책을 또 어딘가에 꽂으려면 거기서 또 한 권을 빼야 합니다 — 세 번만 하면 바닥에 더미가 생기고 「이거 어디서 뺐지」가 됩니다. 그래서 **서로 한 권씩 맞바꾸는 것부터**, 그다음 **방금 자리가 생긴 칸으로**, 꼭 필요할 때만 **한 권만 들고 빙 도는** 순서로 세웠습니다 — **손에 드는 책은 언제나 한 권뿐입니다.**":
    "The shelves are full. To shelve a book where there is no gap you must first take one out, and to shelve that one you must take another out somewhere else — three rounds of that and there is a pile on the floor and nobody remembers where it came from. So the order is **straight swaps first**, then **into a slot that has just opened up**, and only where it cannot be avoided, **one book carried around a loop** — **you are never holding more than one book.**",
  "**이 등급에 여유 있는 칸이 없습니다.** 다른 칸에서도 받을 자리가 없으니, 칸을 하나 더 쓰는 수밖에 없습니다.":
    "**No slot at this level has room.** No other slot can take them either, so one more slot is the only way.",
  "책장을 더 놓을 자리가 **실제로 있을 때만** 칸을 추가해 주세요. 공간은 한계가 있어서, 모자랄 때마다 칸을 늘리면 나중에 둘 곳이 없어집니다 — 먼저 위의 정원을 재어 적는 쪽이 대개 맞습니다.":
    "Add a slot **only if there is really room** for another shelf. Space runs out, and adding one every time things are tight leaves nowhere to put the next — measuring and recording the capacity above is usually the right move first.",
  "이 등급 칸의 정원을 다 합쳐도 책이 더 많습니다. **정원이 실제보다 작게 잡혀 있을** 가능성이 큽니다 — 칸마다 몇 권 더 들어가는지 위에서 적어 주시면 그만큼 들어갑니다.":
    "Even all the slot capacities at this level added together come to less than the books. **The capacities are probably recorded lower than reality** — note above how many more fit in each slot and that many will go in.",
  "계획은 **시리즈 → 같은 제목 → 같은 작가(2권 이상) → 같은 출판사(3권 이상)** 순으로 책을 묶어 한 칸에 넣습니다. 그런데 **시리즈가 적힌 줄은 전체 1,230줄 중 37줄**뿐입니다. 셋 다 비어 있는 책은 어디에도 붙지 못해 낱권으로 흩어집니다 — 이 등급에 **{n}권** 있습니다(예: Brisingr 는 시리즈·작가·출판사가 모두 비어 있어서 Eldest 와 같은 시리즈라는 것을 알 길이 없습니다).":
    "The plan groups books into a slot by **series → same title → same author (2+ books) → same publisher (3+ books)**. But **only 37 of all 1,230 rows have a series recorded**. A book with all three blank has nothing to attach to and ends up scattered as a single — there are **{n} of them at this level** (for example Brisingr has no series, author or publisher, so there is no way to know it belongs with Eldest).",
  "**한 번에 다 하지 않아도 됩니다.** 정리하다 「이 둘은 같은 세트인데」가 눈에 띄면 그때 아래 ③ 목록에서 **＋세트**로 골라 이름을 적어 주세요. 한 번 적으면 다음 계획부터 늘 같은 칸으로 묶입니다. 지금 당장은 이 책들도 작가·제목 순으로 제자리를 받아 정리됩니다.":
    "**You do not have to do all of this at once.** When «these two belong together» catches your eye while tidying, pick them with **＋Set** in list ③ below and give the set a name. Once named, they group into the same slot from the next plan onward. For now these books still get a place of their own, ordered by author and title.",
  "아직 꺼져 있습니다 — Vercel의 gia-lib-web → Settings → Environment Variables 에 ANTHROPIC_API_KEY 를 넣고 다시 배포해 주세요":
    "Still off — add ANTHROPIC_API_KEY under Vercel → gia-lib-web → Settings → Environment Variables, then redeploy",
  "제목으로 **시리즈·작가·분류·대상·렉사일**을 채웁니다. **분류·대상·렉사일은 비워 두지 않습니다**(정리에 쓰는 값이라 비면 순서에서 빠집니다 — 짐작한 값은 「확실하지 않음」으로 표시). 시리즈·작가는 **확실할 때만** 채웁니다. 저장은 확인하고 누를 때만 합니다.":
    "Fills in **series, author, category, audience and Lexile** from the title. **Category, audience and Lexile are never left blank** (they drive the ordering, and a blank drops the book out of it — an estimated value is marked «not certain»). Series and author are filled **only when certain**. Nothing is saved until you look it over and press save.",
  "책마다 **「가야 할 자리」**가 적힙니다(3-4로 갈 책 → 3-4). 그것뿐입니다.":
    "Each book gets a **«slot it should go to»** (a book bound for 3-4 → 3-4). That is all.",
  "**지금 꽂혀 있는 자리는 바뀌지 않습니다.** 실제로 책을 옮기고 자리 등록에서 찍었을 때 바뀝니다 — 정리하는 며칠 동안에도 「그 책 어디 있어요?」에 답할 수 있습니다.":
    "**Where a book currently sits does not change.** That changes when you actually move it and scan it in «Record locations» — so «where is that book?» still has an answer over the days the tidying takes.",
  "마음에 안 들면 **「계획 지우기」**로 적어 둔 자리를 전부 지웁니다. 책은 그대로입니다.":
    "If you do not like it, **«Clear plan»** removes every recorded target. The books themselves stay where they are.",
  "**정리하는 법:** 위 ③의 ①번부터 차례대로 — **↔** 는 두 칸 사이에서 한 권씩 맞바꾸고, **→** 는 방금 자리가 생긴 칸에 그냥 꽂으면 됩니다. 꽂은 뒤 **「자리 등록」에서 그 칸을 찍으면** 그때 자리가 바뀝니다.":
    "**How to tidy:** start at ① in ③ above and work down — **↔** means swapping one book between two slots, **→** means simply shelving into a slot that has just opened up. Once shelved, **scanning that slot in «Record locations»** is when the location changes.",
  "지금 이 칸들은 **임시**입니다 — 「무작정 꽂아 둔 칸」이라는 뜻이고, 그래서 자리를 알려줄 때도 「아마 거기」였습니다. 실제로 다 옮기고 **자리 등록에서 찍어** 넣었다면 그 자리가 이제 그 책의 **제자리**입니다. 그 사실을 적는 것이 이 걸음입니다.":
    "These slots are **temporary** right now — meaning «slots things were put in for the time being», which is why directions came with a «probably». Once you have actually moved everything and **scanned it in «Record locations»**, that slot is now the book's **proper place**. This step records that fact.",
  "그 등급 책의 **「가야 할 자리」를 비웁니다** — 이제 가야 할 곳이 아니라 **있는 곳**이 답입니다. 책을 찍거나 검색하면 그 자리가 나오고, 반납 정리도 그 자리로 묶입니다":
    "**Clears the «slot it should go to»** for that level's books — the answer is no longer where a book should go but **where it is**. Scanning or searching a book shows that slot, and returns are grouped by it",
  "밖에 있는 책은 **제자리 없는 책**으로 남습니다. 꽂은 뒤 **자리 등록**에서 찍으면 제자리가 됩니다 — 몇 권 일부러 빼 두신 것이면 그대로 진행하셔도 됩니다.":
    "Books that are out stay **books with no place**. Shelve them, scan them in **«Record locations»**, and they get one — if you set a few aside deliberately, carry on.",
  "점검을 한 번 눌러 숫자를 본 뒤에 등록할 수 있게 해 두었습니다 — 모르고 끝맺으면 밖에 있는 책이 조용히 제자리를 잃습니다.":
    "Registering is only possible after you press Check and see the numbers — finishing unaware would quietly leave the books that are out with no place.",
  "아이들이 쉬는 시간에 빼서 읽고 아무 데나 끼워 놓으면 기록은 금세 「한때 거기 있었던 책들」이 됩니다. 전부 다시 찍는 데는 며칠이 걸리니 **등급 하나씩** 끊어서 돕니다 — 6등급은 맨 위라 손이 덜 닿으니 가장 적게 어긋나 있습니다.":
    "Children pull books out at break and slot them back anywhere, so the record soon becomes «books that used to be there». Rescanning everything takes days, so this goes **one level at a time** — level 6 sits highest, out of easy reach, so it drifts the least.",
  "지금 적혀 있는 자리를 그대로 믿고 정리합니다. 최근에 찍은 칸이면 이게 빠릅니다 — 다만 아이들이 빼 간 책은 **옛 칸에 그대로 적혀 있어** 정리 목록에서 「그 칸에 있다」고 나옵니다.":
    "Tidies from the locations already on record. That is the quick way when the slots were scanned recently — but a book a child took out **still reads as sitting in its old slot**, so the tidy list will claim it is there.",
  "한 칸을 다 찍고 **「이 칸 다 찍었습니다」**를 누르면 그 칸 기록이 **찍은 것으로 통째로 바뀝니다** — 떠난 책은 그 자리에서 사라집니다. 안 찍은 칸은 옛 기록 그대로 둡니다.":
    "Scan a whole slot, then press **«This slot is done»**: that slot's record is **replaced wholesale by what you scanned** — books that have left disappear from it. Slots you do not scan keep their old record.",
  "이 등급 칸에는 **남의 등급 책 {n}권**도 함께 꽂혀 있습니다 — 위의 칸 목록에 보이는 권수에는 그것까지 들어 있습니다.":
    "These slots also hold **{n} books from other levels** — the counts in the slot list above include them.",
  "**다른 칸**이 적혀 있으면 아이가 거기에 끼워 놓은 것입니다 — 가져와서 이 등급 칸에 꽂고 찍으면 맞습니다. 아무 자리도 없으면 아직 안 찍은 칸에 있거나, 손에 모아 둔 책이거나, 없어진 것입니다.":
    "**Another slot** on record means a child shelved it there — bring it back, shelve it in this level's slot and scan it. No location at all means it is in a slot not yet scanned, in a pile on the desk, or gone.",
  "라벨은 다른 등급인데 이 칸에 있습니다. 그 등급 칸으로 옮기고, 자리 등록에서 찍으면 기록도 따라옵니다.":
    "The label is for another level but the book sits in this slot. Move it to that level's slot; scanning it in «Record locations» brings the record along.",
};
