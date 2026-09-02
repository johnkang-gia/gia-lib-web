import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 학생 사진 주소 모아오기.
 *
 * 요청: "운영앱 학생데이터에 학생 사진도 넣었어, 도서관 카드 만들때 학생사진도 넣어서".
 *
 * 사진은 운영앱이 여권 규격으로 잘라 student-photos 버킷에 넣어둔 것을 그대로 씁니다.
 * 이 버킷은 **비공개**입니다 - 아이 얼굴이라 공개 주소를 만들지 않고, 볼 때마다 한 시간짜리
 * 서명 주소를 발급받습니다. 그래서 인쇄 화면을 열 때마다 여기서 주소를 새로 받아옵니다.
 *
 * 도서관이 따로 올려둔 사진(lib_student_photos)이 있으면 그쪽을 우선합니다. 운영앱에 아직
 * 사진이 없는 학생만 임시로 넣어두는 용도입니다.
 */
export async function getStudentPhotoUrls(
  supabase: SupabaseClient,
  students: { student_no: string; photo_path?: string | null }[]
): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  if (students.length === 0) return urls;

  // ── ① 운영앱 사진(비공개 버킷 → 서명 주소) ──────────────────────────────
  const withPath = students.filter((s) => (s.photo_path ?? "").trim());
  if (withPath.length > 0) {
    const paths = withPath.map((s) => s.photo_path as string);
    const { data } = await supabase.storage
      .from("student-photos")
      .createSignedUrls(paths, 60 * 60);

    // 돌려받은 순서가 요청 순서와 같지 않을 수 있어 경로로 맞춰 넣습니다.
    const byPath = new Map(
      ((data ?? []) as { path: string | null; signedUrl: string | null }[])
        .filter((row) => row.path && row.signedUrl)
        .map((row) => [row.path as string, row.signedUrl as string])
    );
    for (const s of withPath) {
      const url = byPath.get(s.photo_path as string);
      if (url) urls[s.student_no] = url;
    }
  }

  // ── ② 도서관이 직접 올린 사진이 있으면 그쪽이 우선 ──────────────────────
  const { data: libRows } = await supabase
    .from("lib_student_photos")
    .select("student_no,url")
    .in(
      "student_no",
      students.map((s) => s.student_no)
    );
  for (const row of (libRows ?? []) as { student_no: string; url: string }[]) {
    if (row.url) urls[row.student_no] = row.url;
  }

  return urls;
}
