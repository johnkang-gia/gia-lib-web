"use client";

import { useMemo, useRef, useState } from "react";
import StudentCard from "@/components/StudentCard";
import StudentCardBack from "@/components/StudentCardBack";
import { createClient } from "@/lib/supabase/client";
import { formatDay } from "@/lib/dates";
import type { LibSettings, LibStudent } from "@/lib/types";

const TEXT_COLORS = ["#10203a", "#ffffff", "#0f766e", "#7c2d12", "#4c1d95"];

/**
 * 도서카드 인쇄 화면.
 *
 *  · 배경 그림을 올려두면 그 위에 이름·바코드가 얹혀 인쇄됩니다
 *  · 학생 사진을 올려두면 사진이 들어간 카드로도 뽑을 수 있고, 빼고 이름만 뽑을 수도 있습니다
 *  · 반별로 한 번에 선택해 학기 초에 전교생 카드를 한 번에 뽑을 수 있습니다
 */
export type IssueStatus = { count: number; last: string; reissue: number };

export default function CardsClient({
  students,
  photos,
  issued,
  settings,
}: {
  students: LibStudent[];
  photos: Record<string, string>;
  /** 학생별 발급 현황 - 몇 번 뽑았는지, 마지막이 언제인지. */
  issued: Record<string, IssueStatus>;
  settings: LibSettings;
}) {
  const supabase = createClient();
  const [department, setDepartment] = useState("전체");
  const [className, setClassName] = useState("전체");
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [photoMap, setPhotoMap] = useState(photos);
  const [issuedMap, setIssuedMap] = useState(issued);
  /** 목록을 어떤 눈으로 볼지 - 사진/발급 여부로 걸러 봅니다. */
  const [view, setView] = useState<"전체" | "사진있음" | "사진없음" | "미발급" | "발급됨">("전체");
  const [issueNote, setIssueNote] = useState("");
  const [issueMsg, setIssueMsg] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState(settings.card_bg_url);
  const [textColor, setTextColor] = useState(settings.card_text_color);
  /**
   * 어떤 디자인으로 뽑을지.
   *
   * 예전에는 배경 그림이 올라와 있으면 **무조건** 그 그림이 쓰였습니다. 그래서 새로 만든 GIA
   * 기본 디자인(남색·금색·문장)이 화면에 나타나지 않았습니다 - 예전에 올려둔 그림 한 장이
   * 조용히 덮고 있었던 것입니다. 이제 어느 쪽으로 뽑을지 여기서 고르고, 기본은 GIA 디자인입니다.
   */
  const [useBg, setUseBg] = useState(false);
  /**
   * 앞뒤를 어떻게 뽑을지.
   *
   * 앞면만 뽑으면 뒤가 하얗게 남습니다. 접이식은 한 장에 뒷면·앞면을 붙여 뽑고 가운데를 접는
   * 방식이라 앞뒤가 어긋날 수가 없습니다(A4 한 장에 4명분). 양면은 종이가 적게 들지만
   * 앞뒤가 1~2mm 어긋나는 일이 흔합니다. 그래서 접이식을 기본으로 둡니다.
   */
  const [fold, setFold] = useState(true);
  /**
   * 사진을 넣을지. 저장된 설정이 꺼져 있어도 **사진이 준비된 학생이 있으면 켠 채로 시작**합니다.
   * 이 설정은 사진 기능이 생기기 전에 만들어진 것이라 기본값이 '꺼짐'이었고, 그 탓에 사진을
   * 다 올려놓고도 이름만 인쇄되는 일이 있었습니다.
   */
  const [withPhoto, setWithPhoto] = useState(
    settings.card_show_photo || Object.keys(photos).length > 0
  );
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

      const hasPhoto = Boolean(photoMap[s.student_no]);
      const wasIssued = Boolean(issuedMap[s.student_no]);
      if (view === "사진있음" && !hasPhoto) return false;
      if (view === "사진없음" && hasPhoto) return false;
      if (view === "미발급" && wasIssued) return false;
      if (view === "발급됨" && !wasIssued) return false;

      if (!kw) return true;
      return `${s.name} ${s.name_en ?? ""} ${s.student_no}`.toLowerCase().includes(kw);
    });
  }, [students, department, className, keyword, view, photoMap, issuedMap]);

  const allSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  /** 지금 목록에서 사진이 있어 바로 뽑을 수 있는 학생 수. */
  const photoReady = filtered.filter((s) => photoMap[s.student_no]).length;
  const noPhotoCount = filtered.length - photoReady;
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

  /**
   * 사진이 있는 학생만 고릅니다.
   *
   * 요청: "사진있는 애들만 뽑을 수 있게 해주고 사진 없는 애들은 사진 넣으면 뽑을 수 있게".
   * 사진 없는 카드가 섞여 나오면 그 아이만 다시 뽑아야 하고, 그 한 장 때문에 A4를 또 씁니다.
   */
  function selectWithPhoto() {
    setSelected(new Set(filtered.filter((s) => photoMap[s.student_no]).map((s) => s.id)));
  }

  /**
   * 방금 인쇄한 것을 발급 기록에 남깁니다.
   * 처음 받는 학생은 '최초', 이미 받은 적 있으면 '재발급'으로 서버가 알아서 적습니다.
   */
  async function recordIssue() {
    if (selectedList.length === 0) return;
    setBusy("issue");
    setError(null);
    setIssueMsg(null);
    try {
      const res = await fetch("/api/cards/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentNos: selectedList.map((s) => s.student_no),
          note: issueNote,
        }),
      });
      const json = (await res.json()) as {
        recorded?: number;
        first?: number;
        reissued?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "기록하지 못했습니다.");

      // 화면에도 바로 반영합니다(새로고침 없이 체크 표시가 붙도록).
      const now = new Date().toISOString();
      setIssuedMap((prev) => {
        const next = { ...prev };
        for (const s of selectedList) {
          const before = next[s.student_no];
          next[s.student_no] = {
            count: (before?.count ?? 0) + 1,
            last: now,
            reissue: (before?.reissue ?? 0) + (before ? 1 : 0),
          };
        }
        return next;
      });
      setIssueMsg(
        `${json.recorded ?? 0}명 발급 기록 완료` +
          ((json.reissued ?? 0) > 0 ? ` (재발급 ${json.reissued}명)` : "")
      );
      setIssueNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "기록하지 못했습니다.");
    } finally {
      setBusy(null);
    }
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
    setUseBg(false);
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

            {/* 디자인 고르기 - 기본은 GIA 디자인입니다. */}
            <div className="mt-4 inline-flex rounded-xl bg-slate-100 p-1 text-sm">
              <button
                type="button"
                onClick={() => setUseBg(false)}
                className={`rounded-lg px-4 py-1.5 font-semibold transition ${
                  useBg ? "text-slate-500 hover:text-slate-700" : "bg-white text-slate-900 shadow-sm"
                }`}
              >
                GIA 기본 디자인
              </button>
              <button
                type="button"
                onClick={() => setUseBg(true)}
                disabled={!bgUrl}
                className={`rounded-lg px-4 py-1.5 font-semibold transition disabled:opacity-40 ${
                  useBg ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
                title={bgUrl ? "올려둔 배경 그림으로 뽑습니다" : "먼저 배경 그림을 올려주세요"}
              >
                올린 배경 그림
              </button>
            </div>

            {/* 앞뒤 뽑는 방식 - 뒤가 백지로 남지 않게. */}
            <div className="mt-3 inline-flex rounded-xl bg-slate-100 p-1 text-sm">
              <button
                type="button"
                onClick={() => setFold(true)}
                className={`rounded-lg px-4 py-1.5 font-semibold transition ${
                  fold ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
                title="한 장에 앞뒤를 붙여 뽑고 반으로 접습니다"
              >
                접어서 앞뒤 (권장)
              </button>
              <button
                type="button"
                onClick={() => setFold(false)}
                className={`rounded-lg px-4 py-1.5 font-semibold transition ${
                  fold ? "text-slate-500 hover:text-slate-700" : "bg-white text-slate-900 shadow-sm"
                }`}
                title="앞면 시트와 뒷면 시트를 따로 뽑습니다"
              >
                양면 인쇄
              </button>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              {fold
                ? "한 장에 뒷면과 앞면이 위아래로 붙어 나옵니다. 잘라서 가운데를 접고 코팅하면 앞뒤가 모두 남색이 됩니다. 접힌 쪽이 카드 윗변이 되고 종이가 두 겹이라 더 빳빳합니다. A4 한 장에 4명분."
                : "앞면 시트와 뒷면 시트가 따로 나옵니다. A4 한 장에 10명분으로 종이는 적게 들지만, 양면 인쇄는 앞뒤가 1~2mm 어긋나는 일이 흔해 잘라 보면 티가 납니다."}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => bgInputRef.current?.click()}
                disabled={busy === "bg"}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
              <b>GIA 기본 디자인</b>은 남색 바탕에 금색 띠와 학교 문장이 들어간 카드입니다. 직접
              만든 그림으로 뽑고 싶으면 가로로 긴 그림(권장 1012 × 638px 이상, 카드 비율 86:54)을
              올린 뒤 <b>올린 배경 그림</b>을 고르세요. 바코드는 어느 쪽이든 항상 흰 바탕 위에
              얹혀 인쇄되므로 스캔이 잘 됩니다.
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
              <p className="mb-2 text-center text-xs font-semibold text-slate-400">
                미리보기 — 앞면
              </p>
              <StudentCard
                student={sample}
                libraryName={settings.library_name}
                bgUrl={useBg ? bgUrl : null}
                textColor={textColor}
                photoUrl={photoMap[sample.student_no] ?? null}
                showPhoto={withPhoto}
                preview
              />
              <p className="mt-3 mb-2 text-center text-xs font-semibold text-slate-400">뒷면</p>
              <StudentCardBack
                libraryName={settings.library_name}
                settings={settings}
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
        <select
          value={view}
          onChange={(e) => setView(e.target.value as typeof view)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="전체">전체 보기</option>
          <option value="사진있음">사진 있는 학생만</option>
          <option value="사진없음">사진 없는 학생만</option>
          <option value="미발급">아직 안 뽑은 학생만</option>
          <option value="발급됨">이미 뽑은 학생만</option>
        </select>

        <button
          type="button"
          onClick={toggleAll}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          {allSelected ? "선택 해제" : `전체 선택 (${filtered.length}명)`}
        </button>

        <button
          type="button"
          onClick={selectWithPhoto}
          disabled={photoReady === 0}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40"
          title="사진이 없는 학생은 빼고 고릅니다"
        >
          📷 사진 있는 {photoReady}명만 선택
        </button>

        <button
          type="button"
          disabled={selectedList.length === 0}
          onClick={() =>
            window.open(
              `/print/cards?ids=${selectedList.map((s) => s.id).join(",")}` +
                (withPhoto ? "&photo=1" : "") +
                (useBg ? "&bg=1" : "") +
                (fold ? "" : "&layout=flat"),
              "_blank"
            )
          }
          className="ml-auto rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
        >
          선택한 {selectedList.length}명 카드 인쇄
        </button>
      </div>

      {/* ── 인쇄한 뒤 발급 기록 ─────────────────────────────────────────── */}
      {selectedList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-white">
          <span className="text-sm">
            인쇄를 마치셨으면 <b>발급 기록</b>을 남겨 주세요 — 누가 카드를 받았는지, 잃어버려
            다시 뽑았는지가 남습니다.
          </span>
          <input
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
            placeholder="메모 (예: 분실 재발급)"
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white placeholder:text-white/40"
          />
          <button
            type="button"
            onClick={() => void recordIssue()}
            disabled={busy === "issue"}
            className="ml-auto rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-900 disabled:opacity-50"
          >
            {busy === "issue" ? "기록 중…" : `${selectedList.length}명 발급 기록하기`}
          </button>
        </div>
      )}

      {issueMsg && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{issueMsg}</p>
      )}

      {noPhotoCount > 0 && (view === "전체" || view === "사진없음") && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
          이 목록에서 <b>{noPhotoCount}명</b>은 아직 사진이 없어 카드를 뽑을 수 없습니다.
          운영앱 학생 관리에서 사진을 올리면 바로 뽑을 수 있고, 사진 칸의 <b>+사진</b>을 눌러
          도서관에서 직접 올릴 수도 있습니다.
        </p>
      )}

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
              <th className="px-3 py-2.5 font-semibold">발급</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                  조건에 맞는 학생이 없습니다. 학생 명부는 운영앱(gia-ops)에서 관리합니다.
                </td>
              </tr>
            )}
            {filtered.map((student) => (
              <tr
                key={student.id}
                className={
                  selected.has(student.id)
                    ? "bg-blue-50/60"
                    : photoMap[student.student_no]
                      ? undefined
                      : "bg-amber-50/40"
                }
              >
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
                <td className="px-3 py-2">
                  {issuedMap[student.student_no] ? (
                    <span className="whitespace-nowrap text-xs">
                      <span className="font-bold text-emerald-600">✓ 발급</span>
                      {issuedMap[student.student_no].count > 1 && (
                        <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">
                          {issuedMap[student.student_no].count}번째
                        </span>
                      )}
                      <span className="ml-1 block text-[11px] text-slate-400">
                        {formatDay(issuedMap[student.student_no].last)}
                      </span>
                    </span>
                  ) : photoMap[student.student_no] ? (
                    <span className="text-xs text-slate-400">아직</span>
                  ) : (
                    <span className="text-xs text-amber-600">사진 필요</span>
                  )}
                </td>
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
