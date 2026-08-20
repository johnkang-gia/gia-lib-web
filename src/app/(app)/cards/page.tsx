import CardsClient from "./CardsClient";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/server/library";
import type { LibStudent, LibStudentPhoto } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const supabase = await createClient();

  const [{ data: students }, { data: photoRows }, settings] = await Promise.all([
    supabase
      .from("lib_students")
      .select("id,student_no,name,name_en,grade,class_name,department,status")
      .eq("status", "active")
      .order("student_no", { ascending: true }),
    supabase.from("lib_student_photos").select("*"),
    getSettings(supabase),
  ]);

  const photos: Record<string, string> = {};
  for (const row of (photoRows ?? []) as LibStudentPhoto[]) photos[row.student_no] = row.url;

  return (
    <CardsClient
      students={(students ?? []) as LibStudent[]}
      photos={photos}
      settings={settings}
    />
  );
}
