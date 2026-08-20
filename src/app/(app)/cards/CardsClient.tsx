"use client";

import { useMemo, useRef, useState } from "react";
import StudentCard from "@/components/StudentCard";
import { createClient } from "@/lib/supabase/client";
import type { LibSettings, LibStudent } from "@/lib/types";

const TEXT_COLORS = ["#10203a", "#ffffff", "#0f766e", "#7c2d12", "#4c1d95"];

/**
 * 도서카드 인쇄 화면.
 *
 *  · 배경 그림을 올려두면 그 위에 이름·바코드가 얹혀 인쇄됩니다
 *  · 학생 사진을 올려두면 사진이 들어간 카드로도 뽑을 수 있고, 빼고 이름만 뽑을 수도 있습니다
 *  · 반별로 한 번에 선택해 학기 초에 전교생 카드를 한 번에 뽑을 수 있습니다
 */
export default function CardsClient({
  students,
  photos,
  settings,
}: {
  students: LibStudent[];
  photos: Record<string, string>;
  settings: LibSettings;
}) {
  const supabase = createClient();
  const [department, setDepartment] = useState("전체");
  const [className, setClassName] = useState("전체");
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [photoMap, setPhotoMap] = useState(photos);
  const [bgUrl, setBgUrl] = useState(settings.card_bg_url);
  const [textColor, setTextColor] = useState(settings.card_text_color);
  const [withPhoto, setWithPhoto] = useState(settings.card_show_photo);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<LibStudent | null>(null);

  const classes = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      const label = [s.grade, s.class_name].filter(Boolean).join(" ");
      if (label) set.add(label);
    });
    return ["전체", ...[...set].sort()];
  }, [students]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return students.filter((s) => {
      if (department !== "전체" && s.department !== department) return false;
      const label = [s.grade, s.class_name].filter(Boolean).join(" ");
      if (className !== "전체" && label !== className) return false;
      if (!kw) return true;
      return `${s.name} ${s.name_en ?? ""} ${s.student_no}`.toLowerCase().includes(kw);
    });
  }, [students, department, className, keyword]);

  const allSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  const selectedList = students.filter((s) => selected.has(s.id));
  const sample = selectedList[0] ?? filtered[0] ?? students[0];

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach((s) => next.delete(s.id));
      else filtered.forEach((s) => next.add(s.id));
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 그림 파일을 Supabase 저장소에 올리고 공개 주소를 돌려줍니다. */
  async function upload(path: string, file: File) {
    const { error: err } = await supabase.storage
      .from("library")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (err) throw new Error(err.message);
    const { data } = supabase.storage.from("library").getPublicUrl(path);
    // 같은 주소에 덮어써도 브라우저가 옛 그림을 계속 쓰지 않도록 시각을 붙입니다.
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  async function onPickBackground(file: File) {
    setBusy("bg");
    setError(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const url = await upload(`card-bg/background.${ext}`, file);
      const { error: err } = await supabase
        .from("lib_settings")
        .update({ card_bg_url: url })
        .eq("id", 1);
      if (err) throw new Error(err.message);
      setBgUrl(url);
    } catch (e) {
      setError(
        `배경 그림을 올리지 못했습니다: ${e instanceof Error ? e.message : "알 수 없는 오류"}`
      );
    } finally {
      setBusy(null);
    }
  }

  async function onPickPhoto(file: File) {
    const student = photoTargetRef.current;
    if (!student) return;
    setBusy(student.id);
    setError(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const url = await upload(`photos/${student.student_no}.${ext}`, file);
      const { error: err } = await supabase
        .from("lib_student_photos")
        .upsert({ student_no: student.student_no, url });
      if (err) throw new Error(err.message);
      setPhotoMap((prev) => ({ ...prev, [student.student_no]: url }));
    } catch (e) {
      setError(`사진을 올리지 못했습니다: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setBusy(null);
      photoTargetRef.current = null;
    }
  }

  async function saveCardOption(changes: Partial<LibSettings>) {
    const { error: err } = await supabase.from("lib_settings").update(changes).eq("id", 1);
    if (err) setError(err.message);
  }

  async function clearBackground() {
    setBgUrl(null);
    await saveCardOption({ card_bg_url: null });
  }

  return (
    <div className="space-y-4">
      {/* ── 카드 디자인 ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start gap-6">
          <div className="min-w-[280px] flex-1">
            <h1 className="text-lg font-bold">도서카드 인쇄</h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              학생 고유번호(GIA-2026-0001)가 바코드로 들어간 카드를 신용카드 크기(86 × 54mm)로
              인쇄합니다. A4 한 장에 10장씩 나오며, 두꺼운 종이에 인쇄해 자르고 코팅하면 됩니다.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => bgInputRef.current?.click()}
                disabled={busy === "bg"}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === "bg" ? "올리는 중…" : bgUrl ? "배경 그림 바꾸기" : "배경 그림 올리기"}
              </button>
              {bgUrl && (
                <button
                  type="button"
                  onClick={() => void clearBackground()}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  배경 없애기
                </button>
              )}
              <input
                ref={bgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onPickBackground(file);
                  e.target.value = "";
                }}
              />
            </div>

            <p className="mt-2 text-xs text-slate-400">
              가로로 긴 그림(권장 1012 × 638px 이상, 카드 비율 86:54)이 가장 잘 맞습니다. 바코드는
              어떤 배경이든 항상 흰 바탕 위에 얹혀 인쇄되므로 스캔이 잘 됩니다.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500">글자색</span>
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setTextColor(c);
                      void saveCardOption({ card_text_color: c });
                    }}
                    className={`h-5 w-5 rounded-full border border-slate-300 ${
                      textColor === c ? "ring-2 ring-slate-900 ring-offset-1" : ""
                    }`}
                    style={{ background: c }}
                    aria-label={`글자색 ${c}`}
                  />
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={withPhoto}
                  onChange={(e) => {
                    setWithPhoto(e.target.checked);
                    void saveCardOption({ card_show_photo: e.target.checked });
                  }}
                  className="h-4 w-4"
                />
                사진 넣어서 인쇄
              </label>
            </div>
          </div>

          {sample && (
            <div className="shrink-0">
              <p className="mb-2 text-center text-xs font-semibold text-slate-400">미리보기</p>
              <StudentCard
                student={sample}
                libraryName={settings.library_name}
                bgUrl={bgUrl}
                textColor={textColor}
                photoUrl={photoMap[sample.student_no] ?? null}
                showPhoto={withPhoto}
                preview
              />
            </div>
          )}
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </section>

      {/* ── 학생 고르기 ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {["전체", "유치부", "초등부", "중고등부"].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select
          value={className}
          onChange={(e) => setClassName(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {classes.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="이름 · 고유번호 검색"
          className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={toggleAll}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          {allSelected ? "이 목록 선택 해제" : `이 목록 전체 선택 (${filtered.length}명)`}
        </button>

        <button
          type="button"
          disabled={selectedList.length === 0}
          onClick={() =>
            window.open(
              `/print/cards?ids=${selectedList.map((s) => s.id).join(",")}${withPhoto ? "&photo=1" : ""}`,
              "_blank"
            )
          }
          className="ml-auto rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
        >
          선택한 {selectedList.length}명 카드 인쇄
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2.5" />
              <th className="w-16 px-3 py-2.5 font-semibold">사진</th>
              <th className="px-3 py-2.5 font-semibold">고유번호</th>
              <th className="px-3 py-2.5 font-semibold">이름</th>
              <th className="px-3 py-2.5 font-semibold">학년 / 반</th>
              <th className="px-3 py-2.5 font-semibold">부서</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  조건에 맞는 학생이 없습니다. 학생 명부는 운영앱(gia-ops)에서 관리합니다.
                </td>
              </tr>
            )}
            {filtered.map((student) => (
              <tr key={student.id} className={selected.has(student.id) ? "bg-blue-50/60" : undefined}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(student.id)}
                    onChange={() => toggle(student.id)}
                    className="h-4 w-4"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      photoTargetRef.current = student;
                      photoInputRef.current?.click();
                    }}
                    disabled={busy === student.id}
                    className="group relative h-11 w-9 overflow-hidden rounded bg-slate-100 text-[10px] text-slate-400"
                    title="사진 올리기"
                  >
                    {photoMap[student.student_no] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoMap[student.student_no]}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : busy === student.id ? (
                      "…"
                    ) : (
                      "+사진"
                    )}
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{student.student_no}</td>
                <td className="px-3 py-2 font-medium">
                  {student.name}
                  {student.name_en && (
                    <span className="ml-1 text-xs text-slate-400">{student.name_en}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {[student.grade, student.class_name].filter(Boolean).join(" ") || "-"}
                </td>
                <td className="px-3 py-2 text-slate-500">{student.department ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPickPhoto(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
