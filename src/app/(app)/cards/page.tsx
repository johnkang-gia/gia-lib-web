import CardsClient from "./CardsClient";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";
import { getStudentPhotoUrls } from "@/lib/server/photos";
import type { LibStudent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const supabase = await createClient();

  const [{ data: students }, settings] = await Promise.all([
    supabase
      .from("lib_students")
      .select("id,student_no,name,name_en,grade,class_name,department,status,photo_path")
      .eq("status", "active")
      .order("student_no", { ascending: true }),
    getSettings(supabase),
  ]);

  // 운영앱이 올려둔 사진을 그대로 씁니다(비공개 버킷이라 서명 주소를 받아옵니다).
  const list = (students ?? []) as LibStudent[];
  const photos = await getStudentPhotoUrls(supabase, list);

  return (
    <CardsClient
      students={list}
      photos={photos}
      settings={settings}
    />
  );
}
