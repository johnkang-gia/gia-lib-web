"use client";

import { useState } from "react";
import CoverShot from "@/components/CoverShot";
import CoverCrop from "@/components/CoverCrop";
import { createClient } from "@/lib/supabase/client";
import type { Box } from "@/lib/coverBox";
import { cropImage, refineBox } from "@/lib/cropImage";
import type { LibBook } from "@/lib/types";

/**
 * 이미 등록된 책에 **표지 사진을 붙이는** 창.
 *
 * 요청: "등록한 책이 표지가 없다면 노트북 카메라를 사용해서 표지를 바로 등록할 수 있도록
 * 만들어줘".
 *
 * ── 왜 표지가 없는 책이 생기는가 ────────────────────────────────────────
 * ISBN이 없거나 인터넷 목록에 없는 책(오래된 책·수입 원서·학교에서 만든 자료)은 조회로
 * 표지를 받을 수 없습니다. 표지가 없으면 장서 목록이 📘 아이콘만 늘어선 화면이 되고, 아이가
 * "표지로 책 찾기"를 못 합니다 - 초등학생은 제목보다 표지로 책을 기억합니다.
 *
 * ── 표지를 읽지 못해도 계속 진행합니다 ───────────────────────────────────
 * 사진에서 표지 범위를 자동으로 잡는 일은 읽기 기능(유료)이 해 줍니다. 그게 안 되는 날에도
 * 표지 등록 자체는 되어야 합니다 - 그래서 읽기가 실패하면 범위를 사람이 끌어 맞추는 화면으로
 * 그냥 넘어갑니다. 할 일이 2초 늘어날 뿐 막히지 않습니다.
 */
export default function BookCoverShotDialog({
  book,
  onClose,
  onSaved,
}: {
  book: LibBook;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [shot, setShot] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  /*
    ── 자동이 먼저, 고치기는 예외 ─────────────────────────────────────────
    요청: "범위 자르기는 수정하는 느낌이고, 최대한 자동으로 범위 체크해서 표지 넣을 수 있게".

    예전에는 찍을 때마다 네모를 끌어 맞추는 화면이 떴습니다. 제대로 찍은 사진까지 매번
    손으로 맞춰야 했고, 한 권에 몇 초씩 더 걸렸습니다. 이제 찍으면 **잘라낸 표지가 바로**
    보이고, 맞으면 누르면 끝입니다. 어긋났을 때만 '범위 고치기'로 들어갑니다.
  */
  const [cropped, setCropped] = useState<{ blob: Blob; preview: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  /** 찍은 사진에서 표지 범위를 받아옵니다(제목 검색은 하지 않습니다 - 어느 책인지 압니다). */
  async function readBox(dataUrl: string) {
    setBusy(true);
    setNote(null);
    setWarn(null);
    setCropped(null);
    setEditing(false);
    try {
      const res = await fetch("/api/books/cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, only: "box", expectTitle: book.title }),
      });
      const json = (await res.json()) as {
        read?: { title: string; box: Box | null };
        titleMatches?: boolean | null;
        error?: string;
      };
      if (!res.ok || !json.read) {
        // 읽기가 안 되는 날에도 표지 등록은 됩니다 - 범위만 손으로 맞추면 됩니다.
        setNote(
          `${json.error ?? "표지를 읽지 못했습니다"} — 범위를 직접 맞춰 표지로 저장할 수 있습니다.`
        );
        setBox(null);
      } else {
        // 모델이 집어 준 네모는 위아래가 밀려 있습니다 - 실제 책 테두리에 맞춰 고칩니다.
        const refined = await refineBox(dataUrl, json.read.box).catch(
          () => json.read?.box ?? null
        );
        setBox(refined);
        if (refined) {
          const out = await cropImage(dataUrl, refined).catch(() => null);
          if (out) setCropped({ blob: out.blob, preview: out.preview });
        }
        if (json.titleMatches === false && json.read.title) {
          // 막지는 않습니다 - 개정판처럼 제목이 조금 다른 경우가 실제로 있습니다.
          setWarn(
            `찍은 표지에서 읽은 제목은 "${json.read.title}" 입니다. 등록된 제목 "${book.title}" 과 달라 보입니다. 다른 책을 찍지 않았는지 확인해 주세요.`
          );
        }
      }
      setShot(dataUrl);
    } catch (e) {
      setNote(
        `${e instanceof Error ? e.message : "표지를 보내지 못했습니다"} — 범위를 직접 맞춰 저장할 수 있습니다.`
      );
      setBox(null);
      setShot(dataUrl);
    } finally {
      setBusy(false);
    }
  }

  /** 잘라낸 표지를 저장소에 올리고 책에 연결합니다. */
  async function save(blob: Blob) {
    setBusy(true);
    setNote(null);
    try {
      // 파일 이름은 책 id로 둡니다 - ISBN이 없는 책도 있고, 다시 찍으면 같은 자리에 덮입니다.
      const path = `covers/book-${book.id}.jpg`;
      const up = await supabase.storage
        .from("library")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (up.error) throw new Error(up.error.message);
      const { data } = supabase.storage.from("library").getPublicUrl(path);
      // 같은 주소에 덮어썼으므로 브라우저가 옛 사진을 쥐고 있습니다 - 뒤에 표를 붙입니다.
      const url = `${data.publicUrl}?v=${Date.now()}`;

      const { error } = await supabase
        .from("lib_books")
        .update({ cover_url: url })
        .eq("id", book.id);
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "표지를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500">표지 사진 등록</p>
            <p className="truncate text-base font-bold text-gia-navy">{book.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-2 py-1 text-sm font-semibold text-slate-400 hover:bg-slate-100"
          >
            닫기
          </button>
        </div>

        {warn && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">{warn}</p>
        )}
        {note && (
          <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2.5 text-sm text-slate-700">{note}</p>
        )}

        {!shot ? (
          <CoverShot busy={busy} onShot={(dataUrl) => void readBox(dataUrl)} onClose={onClose} />
        ) : editing || !cropped ? (
          <CoverCrop
            src={shot}
            initial={box}
            busy={busy}
            label="이 표지로 등록"
            onCancel={() => {
              if (cropped) setEditing(false);
              else {
                setShot(null);
                setWarn(null);
              }
            }}
            onDone={(blob) => void save(blob)}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              배경을 잘라낸 표지입니다. 맞으면 그대로 등록하세요.
            </p>
            <div className="flex justify-center rounded-xl bg-slate-100 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cropped.preview}
                alt="잘라낸 표지"
                className="max-h-[42vh] w-auto max-w-full rounded-lg bg-white object-contain shadow-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void save(cropped.blob)}
                disabled={busy}
                className="flex-[2] rounded-xl bg-gia-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? "저장하는 중…" : "이 표지로 등록"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-50"
              >
                범위 고치기
              </button>
              <button
                type="button"
                onClick={() => {
                  setShot(null);
                  setCropped(null);
                  setWarn(null);
                }}
                disabled={busy}
                className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 disabled:opacity-50"
              >
                다시 찍기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
