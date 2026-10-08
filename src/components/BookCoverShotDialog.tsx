"use client";

import { useState } from "react";
import CoverShot from "@/components/CoverShot";
import CoverCrop from "@/components/CoverCrop";
import { createClient } from "@/lib/supabase/client";
import type { Box } from "@/lib/coverBox";
import { refineBox } from "@/lib/cropImage";
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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  /** 찍은 사진에서 표지 범위를 받아옵니다(제목 검색은 하지 않습니다 - 어느 책인지 압니다). */
  async function readBox(dataUrl: string) {
    setBusy(true);
    setNote(null);
    setWarn(null);
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
        setBox(await refineBox(dataUrl, json.read.box).catch(() => json.read?.box ?? null));
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

        {shot ? (
          <CoverCrop
            src={shot}
            initial={box}
            busy={busy}
            label="이 표지로 등록"
            onCancel={() => {
              setShot(null);
              setWarn(null);
            }}
            onDone={(blob) => void save(blob)}
          />
        ) : (
          <CoverShot busy={busy} onShot={(dataUrl) => void readBox(dataUrl)} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
