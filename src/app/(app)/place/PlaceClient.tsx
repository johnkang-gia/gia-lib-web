"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanner from "@/components/BarcodeScanner";
import BookRegisterDialog from "@/components/BookRegisterDialog";
import { formatIsbn, isBookBarcode, isIsbn, normalizeScan } from "@/lib/scan";
import { levelColor } from "@/lib/bookLevels";
import { APP_VERSION } from "@/lib/version";
import { addToPile, fetchPile, type Pile } from "@/lib/pileClient";
import type { LibBook, LibBookWithShelf, LibLocation, ShelfCheckResult } from "@/lib/types";
import type { ShelfListRow } from "@/app/api/shelf-check/list/route";

/** 검사 중에 걸려서 **아직 끝내지 못한** 한 가지. 알림이 아니라 할 일입니다. */
type AuditTodo =
  | { kind: "unknown"; code: string; isIsbn: boolean }
  | { kind: "choices"; code: string; books: LibBookWithShelf[] };

/** 한 칸의 기록 전체. */
type ShelfList = {
  titles: number;
  copies: number;
  /** 그중 지금 대출 나가 있어 책장에는 없는 권수. */
  onLoan: number;
  /** 지금 책장에 꽂혀 있어야 하는 권수 = copies - onLoan. */
  onShelf: number;
  rows: ShelfListRow[];
};

/** 방금 찍어서 이 칸에 적어 둔 한 권. 되돌리려면 찍기 전 자리를 알아야 합니다. */
type Done = {
  key: string;
  bookId: string;
  title: string;
  level: number | null;
  fromCode: string | null;
  /** 다른 칸에도 세어져 있는가(= 옮긴 것이 아니라 나뉘어 있는 것). */
  split: boolean;
  fromId: string | null;
  copiesHere: number;
  warned: boolean;
};

/**
 * 자리 등록 화면.
 *
 * ── 이 화면이 하는 일과 하지 않는 일 ───────────────────────────────────────
 * 하는 일: 이미 등록된 책을 찍어 **지금 이 칸**으로 자리를 옮겨 적습니다.
 * 하지 않는 일: 책을 새로 만들지 않습니다. 등록은 '여러 권 등록'의 일입니다.
 *
 * 시리즈별 정렬도 여기서 하지 않습니다 - 요청대로, 자리가 다 잡힌 뒤에 '정리 계획'에서
 * 합니다. 지금은 "무엇이 어디에 있는가"만 사실대로 적는 단계입니다.
 */
export default function PlaceClient({
  locations,
  checked: checkedFromServer,
}: {
  locations: LibLocation[];
  checked: Record<string, { titles: number; copies: number }>;
}) {
  const router = useRouter();
  /*
    ── 칸 누적 숫자는 여기서 고쳐 씁니다 ─────────────────────────────────────
    예전에는 찍을 때마다(쉬면 1.5초 뒤에) 화면 전체를 서버에서 다시 그려서 이 숫자를
    맞췄습니다. 재어 보니 그 한 번이 **140~190ms** 입니다 - 찍는 일과 상관없는 일이고,
    그리는 동안 커서가 입력칸에서 떨어져 다음 바코드를 흘릴 위험까지 있었습니다.

    이제 서버가 찍은 결과에 이 칸의 종수·권수를 적어 보냅니다(shelfNow). 그 둘만 갈아
    끼우면 되므로 다시 그릴 일이 없습니다. 서버에서 새로 받아 올 때는(칸을 바꾸거나 목록을
    고친 뒤) 그 값이 이깁니다.
  */
  const [patched, setPatched] = useState<Record<string, { titles: number; copies: number }>>({});
  const checked = { ...checkedFromServer, ...patched };
  // 서버가 새 숫자를 들고 오면 손으로 고쳐 둔 것은 버립니다 - 그쪽이 사실입니다.
  useEffect(() => {
    setPatched({});
  }, [checkedFromServer]);
  const [here, setHere] = useState<LibLocation | null>(null);
  const [result, setResult] = useState<ShelfCheckResult | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pile, setPile] = useState<Pile>(null);
  const [note, setNote] = useState<string | null>(null);
  /** 서버가 더 새 버전이면 그 숫자. 띄워 두면 화면 맨 위에서 새로고침을 권합니다. */
  const [stale, setStale] = useState<string | null>(null);
  /*
    ── 여기서 바로 등록 ──────────────────────────────────────────────────
    요청: "등록 안 된 책도 여기서 바로 등록할 수 있게 해줘."

    예전에는 '여러 권 등록'을 새 창으로 열라고 했습니다. 칸을 비우며 서른 권을 찍는 중에
    창을 옮겨 다니면 들고 있던 책을 내려놓게 되고, 어디까지 찍었는지도 흐려집니다. 등록하면
    **그 자리에서 이 칸에 바로 꽂습니다**(등록 → 자리 등록까지 한 번에).
  */
  const [register, setRegister] = useState<{
    isbn?: string;
    code?: string;
    /** place: 등록하고 이 칸에 바로 꽂습니다. audit: 검사 중이라 세기만 합니다. */
    mode: "place" | "audit";
  } | null>(null);
  /*
    ── 목록보기 ──────────────────────────────────────────────────────────
    요청: "목록보기를 누르면 등록된 권수와 어떤 책이 그 책장에 들어갔는지 나왔으면 좋겠어 ...
    실제 책장에는 68권인데 앱에서는 71권이래 ... 수정할 방법이 없어서 수정할 수 있게."

    숫자만 보여주면 어긋났을 때 **어디가 어긋났는지 알 길이 없습니다.** 3권 차이가 어느
    책인지 모르면 칸을 통째로 다시 찍어야 하고, 그건 한나절짜리 일입니다.
  */
  const [listOf, setListOf] = useState<LibLocation | null>(null);
  const [list, setList] = useState<ShelfList | null>(null);
  /*
    ── 대조 검사 ─────────────────────────────────────────────────────────
    요청: "확인은 등록되어 있는 책장에서 실물 책들을 빼서 다시 찍어서 지금 자리 등록에 들어가
    있는 책들과 비교할 수 있도록 만들어줘."

    검사하는 동안에는 **아무것도 쓰지 않습니다.** 세면서 기록이 바뀌면 무엇과 무엇을 맞추고
    있는지 알 수 없게 됩니다. 다 세고 나서 사람이 한 번에 맞춥니다.
  */
  const [audit, setAudit] = useState<Map<string, number> | null>(null);
  const [auditNote, setAuditNote] = useState<string | null>(null);
  /*
    ── 알리기만 하지 않습니다 ────────────────────────────────────────────
    요청: "뭔가를 체크하거나 등록하거나 할 때 그냥 이런 상태라고 고지나 알리지만 말고 그걸
    해결할 수 있게끔 구조적으로 만들어줘."

    검사 중에 "등록 안 된 책입니다"라고 알리고 넘어가면, 그 책은 손에 들려 있는데 할 수 있는
    게 없습니다. 메모해 뒀다가 나중에 다시 찾아야 하고, 그 '나중'은 오지 않습니다. 그래서
    걸린 것은 **지울 수 없는 할 일로 쌓아 두고**, 저마다 그 자리에서 끝낼 버튼을 답니다.
  */
  const [auditTodo, setAuditTodo] = useState<AuditTodo[]>([]);
  const [auditBooks, setAuditBooks] = useState<Record<string, { title: string; level: number | null }>>(
    {}
  );
  const auditRef = useRef<HTMLInputElement>(null);
  const [listBusy, setListBusy] = useState(false);

  /**
   * 「이 칸 다 찍었습니다」.
   *
   * '68권 세어졌다'와 '다 세었다'는 다른 말입니다. 중간에 멈춘 칸도 68권일 수 있고, 자료만
   * 봐서는 구분할 수 없습니다 - 그 칸을 다 비워 봤는지는 **사람만** 압니다. 이 표시가 있어야
   * "2등급 칸이 전부 끝났으니 이제 2등급을 정리해도 된다"고 말할 수 있습니다.
   */
  const markDone = useCallback(
    async (loc: LibLocation, done: boolean) => {
      await fetch("/api/locations/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: loc.id, done }),
      });
      router.refresh();
      setNote(
        done
          ? `${loc.code} 칸을 '다 찍음'으로 표시했습니다. 그 등급 칸이 모두 끝나면 정리 계획에서 그 등급만 먼저 정리할 수 있습니다.`
          : `${loc.code} 칸의 '다 찍음' 표시를 지웠습니다.`
      );
    },
    [router]
  );

  const loadList = useCallback(async (loc: LibLocation) => {
    setListOf(loc);
    setList(null);
    setListBusy(true);
    try {
      const res = await fetch(`/api/shelf-check/list?locationId=${encodeURIComponent(loc.id)}`);
      setList((await res.json()) as ShelfList);
    } catch {
      setList({ titles: 0, copies: 0, onLoan: 0, onShelf: 0, rows: [] });
    } finally {
      setListBusy(false);
    }
  }, []);

  /** 두 번 세어진 책을 한 권 줄이거나, 이 칸 책이 아니었던 것을 통째로 뺍니다. */
  const fixRow = useCallback(
    async (bookId: string, action: "minus" | "remove") => {
      if (!listOf || listBusy) return;
      setListBusy(true);
      try {
        await fetch("/api/shelf-check/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId, locationId: listOf.id, action }),
        });
        const res = await fetch(`/api/shelf-check/list?locationId=${encodeURIComponent(listOf.id)}`);
        setList((await res.json()) as ShelfList);
        router.refresh();
      } finally {
        setListBusy(false);
      }
    },
    [listOf, listBusy, router]
  );

  /** 검사하며 찍습니다. 세기만 하고 아무것도 쓰지 않습니다. */
  const auditScan = useCallback(
    async (raw: string) => {
      const code = normalizeScan(raw);
      if (!code || !audit) return;
      setAuditNote(null);
      try {
        const res = await fetch(`/api/shelf-check/find?code=${encodeURIComponent(code)}`);
        const json = (await res.json()) as {
          book?: LibBookWithShelf | null;
          choices?: LibBookWithShelf[];
          error?: string;
        };
        if (json.choices && json.choices.length > 1) {
          // 같은 ISBN이 등급별로 여러 줄입니다 - 어느 쪽인지는 사람만 압니다. 고를 수 있게 둡니다.
          setAuditTodo((prev) =>
            prev.some((t) => t.code === code)
              ? prev
              : [...prev, { kind: "choices", code, books: json.choices! }]
          );
          setAuditNote(null);
          return;
        }
        const book = json.book;
        if (!book) {
          // 등록 안 된 책입니다 - 여기서 바로 등록할 수 있게 할 일로 쌓습니다.
          setAuditTodo((prev) =>
            prev.some((t) => t.code === code)
              ? prev
              : [...prev, { kind: "unknown", code, isIsbn: isIsbn(code) }]
          );
          setAuditNote(null);
          return;
        }
        setAuditBooks((prev) => ({
          ...prev,
          [book.id]: { title: book.title, level: book.label_level },
        }));
        setAudit((prev) => {
          const next = new Map(prev);
          next.set(book.id, (next.get(book.id) ?? 0) + 1);
          return next;
        });
        setAuditNote(`✔ ${book.title}`);
      } catch {
        setAuditNote("찾는 중 오류가 났습니다.");
      }
    },
    [audit]
  );

  /**
   * 한 권을 센 것으로 칩니다 — 찍어서든, 바코드가 상해서 손으로 체크해서든.
   *
   * 「기록에 있는데 안 나왔습니다」에 뜬 책을 찾아서 책장에 꽂았는데 라벨이 뜯겨 못 찍는
   * 일이 있습니다. 그때 손으로 체크할 길이 없으면 그 한 권 때문에 검사를 끝내지 못합니다.
   */
  const countOne = useCallback((bookId: string, title: string, level: number | null) => {
    setAuditBooks((prev) => ({ ...prev, [bookId]: { title, level } }));
    setAudit((prev) => {
      const next = new Map(prev);
      next.set(bookId, (next.get(bookId) ?? 0) + 1);
      return next;
    });
    setAuditNote(`✔ ${title}`);
  }, []);

  /** 할 일 하나를 지웁니다(끝냈거나, 이 칸 책이 아니었거나). */
  const dropTodo = useCallback((code: string) => {
    setAuditTodo((prev) => prev.filter((t) => t.code !== code));
  }, []);

  /** 다 세고 나서, 찍은 대로 이 칸의 기록을 바꿉니다. */
  const applyAudit = useCallback(async () => {
    if (!listOf || !audit || listBusy) return;
    const counts = [...audit.entries()].map(([bookId, copies]) => ({ bookId, copies }));
    const copies = counts.reduce((n, c) => n + c.copies, 0);
    if (
      !window.confirm(
        `${listOf.code} 칸의 기록을 방금 찍은 ${counts.length}종 ${copies}권으로 바꿉니다.\n\n` +
          "찍히지 않은 책은 이 칸에서 빠집니다(대출 나간 책이 있으면 그 책도 빠지니 주의하세요).\n\n진행할까요?"
      )
    )
      return;
    setListBusy(true);
    try {
      await fetch("/api/shelf-check/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: listOf.id, action: "apply", counts }),
      });
      const res = await fetch(`/api/shelf-check/list?locationId=${encodeURIComponent(listOf.id)}`);
      setList((await res.json()) as ShelfList);
      setAudit(null);
      setAuditNote(null);
      router.refresh();
    } finally {
      setListBusy(false);
    }
  }, [listOf, audit, listBusy, router]);

  /** 이 칸의 센 기록을 통째로 지웁니다(책과 장서 권수는 그대로). */
  const resetShelf = useCallback(async () => {
    if (!listOf || listBusy) return;
    if (
      !window.confirm(
        `${listOf.code} 칸에서 센 기록을 통째로 지웁니다.\n\n` +
          "책이 지워지는 것이 아니라 '이 칸에서 몇 권 찾았나'만 지워집니다. 장서의 보유 권수는 그대로입니다.\n\n진행할까요?"
      )
    )
      return;
    setListBusy(true);
    try {
      await fetch("/api/shelf-check/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: listOf.id, action: "reset" }),
      });
      const res = await fetch(`/api/shelf-check/list?locationId=${encodeURIComponent(listOf.id)}`);
      setList((await res.json()) as ShelfList);
      setAudit(null);
      router.refresh();
    } finally {
      setListBusy(false);
    }
  }, [listOf, listBusy, router]);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 찍기를 멈춘 뒤에 한 번만 숫자를 맞추려고 들고 있는 타이머. */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  /*
    스캐너는 키보드처럼 동작합니다. 칸을 고른 뒤에는 커서가 입력칸에 머물러야 바코드가 흘러
    들어갑니다(카메라를 쓸 때는 필요 없습니다).
  */
  const scanning = Boolean(here) && !camera;
  useEffect(() => {
    if (!scanning) return;
    const id = setInterval(() => {
      if (document.activeElement?.tagName !== "INPUT") inputRef.current?.focus();
    }, 700);
    inputRef.current?.focus();
    return () => clearInterval(id);
  }, [scanning]);

  useEffect(() => {
    void fetchPile().then(setPile);
  }, []);

  const send = useCallback(
    async (payload: {
      code?: string;
      bookId?: string;
      confirm?: "move" | "add" | "home" | "recount" | "relocate" | "level";
      targetBookId?: string;
      targetLocationId?: string;
      level?: number;
      levelScope?: "copy" | "row";
    }) => {
      if (!here || busy) return;
      setBusy(true);
      setNote(null);
      try {
        const res = await fetch("/api/shelf-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, locationId: here.id }),
        });
        /*
          서버가 적어 보낸 버전이 이 화면의 버전과 다르면, 띄워 둔 채로 새 버전이 배포된
          것입니다. 그 상태로 계속 찍으면 서버가 보내는 새 안내를 옛 화면이 그릴 줄 몰라
          **버튼 없이 글자만** 뜹니다. 쓰는 사람에게는 "고를 수가 없다"로만 보입니다.
        */
        const serverVersion = res.headers.get("x-app-version");
        if (serverVersion && serverVersion !== APP_VERSION) setStale(serverVersion);
        const json = (await res.json()) as ShelfCheckResult;
        setResult(json);
        if (json.kind === "placed") {
          setDone((prev) => [
            {
              key: `${json.book.id}-${Date.now()}`,
              bookId: json.book.id,
              title: json.book.title,
              level: json.book.label_level,
              fromCode: json.from?.code ?? null,
              // 다른 칸에도 세어져 있으면 '옮긴' 것이 아닙니다 - 아래 목록도 그렇게 적습니다.
              split: json.otherShelves.length > 0,
              fromId: json.from?.id ?? null,
              copiesHere: json.copiesHere,
              warned: json.notices.some((n) => n.tone === "warn"),
            },
            ...prev,
          ]);
          /*
            칸 누적 숫자를 맞추려고 **화면 전체를 서버에서 다시 그리던** 자리입니다. 한 번이
            140~190ms 이고, 그 사이 화면이 갈리면서 커서가 입력칸에서 떨어집니다 - 바코드는
            키보드처럼 들어오니 그 틈에 찍은 것이 흘러내립니다.

            이제 서버가 그 숫자를 함께 보내 주므로(shelfNow) 그 자리에서 고쳐 씁니다. 다시
            그리지 않습니다.
          */
          const now = json.shelfNow;
          if (now && here) {
            setPatched((prev) => ({ ...prev, [here.id]: now }));
          } else {
            /*
              옛 길(버튼을 눌러 들어온 갈래 등)은 숫자를 안 보냅니다. 그때만 예전처럼 다시
              그립니다 - 손을 멈춘 뒤에 한 번만.
            */
            if (refreshTimer.current) clearTimeout(refreshTimer.current);
            refreshTimer.current = setTimeout(() => router.refresh(), 1500);
          }
        }
      } catch {
        setResult({ kind: "error", message: "처리 중 오류가 생겼습니다." });
      } finally {
        setBusy(false);
      }
    },
    [here, busy, router]
  );

  function handleTyped(raw: string) {
    const code = normalizeScan(raw);
    if (!code) return;
    void send({ code });
  }

  /** 잘못 찍었을 때. 이 칸의 권수를 하나 내리고 자리를 원래대로 돌립니다. */
  async function undo(item: Done) {
    if (!here) return;
    await fetch("/api/shelf-check", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: item.bookId,
        locationId: here.id,
        previousLocationId: item.fromId,
      }),
    });
    setDone((prev) => prev.filter((d) => d.key !== item.key));
    setResult(null);
    router.refresh();
  }

  /** 새로 발급한 라벨을 인쇄 대기에 쌓습니다. 칸을 다 돌고 한 장에 모아 뽑습니다. */
  async function stash(bookId: string) {
    const next = await addToPile([bookId]);
    setPile(next);
    setNote("인쇄 대기에 넣었습니다. 칸을 다 돌고 '인쇄 기록'에서 한꺼번에 뽑으세요.");
  }

  /** 상품코드 한 줄에 여러 권이 묶인 책을 권수만큼 떼어냅니다. */
  async function split(book: LibBookWithShelf) {
    const ok = window.confirm(
      `'${book.title}' ${book.total_copies}권을 ${book.total_copies}줄로 떼어냅니다.\n\n` +
        "각 줄에 도서관 라벨 번호가 하나씩 발급됩니다. 라벨을 붙인 뒤 제목을 실제 권 제목으로 고쳐주세요.\n\n진행할까요?"
    );
    if (!ok) return;
    const res = await fetch("/api/books/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: book.id }),
    });
    const json = (await res.json()) as { count?: number; error?: string };
    setNote(
      res.ok
        ? `${json.count}줄로 떼어냈습니다. 라벨을 인쇄해 붙이고, 각 권을 다시 찍어주세요.`
        : (json.error ?? "떼어내지 못했습니다.")
    );
    router.refresh();
  }


  /*
    ── 한 칸에 무엇이 들어 있나 ─────────────────────────────────────────────
    찍는 화면에서도, 칸 고르는 화면에서도 같은 것을 봅니다. 숫자가 이상할 때는 보통 찍다
    말고 확인하게 되므로, 찍던 자리에서 바로 열려야 합니다.
  */
  const listPanel = listOf && (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <span className="text-2xl font-black" style={{ color: listOf.color }}>
            {listOf.code}
          </span>
          <span className="min-w-0 flex-1 text-sm font-bold text-slate-600">
            {list ? (
              <>
                {list.titles}종 · {list.copies}권
                {/*
                  "다 맞는데 왜 71권이지?"의 답이 보통 여기 있습니다. 찍을 때는 칸에 있었지만
                  그 뒤에 빌려 나간 책은 기록에 남고 책장에는 없습니다. 손으로 센 숫자와
                  맞춰 볼 숫자는 '책장에 있어야 할' 쪽입니다.
                */}
                {list.onLoan > 0 && (
                  <span className="ml-2 font-normal text-slate-500">
                    — 대출 중 {list.onLoan}권 ·{" "}
                    <b className="text-gia-navy">책장에 있어야 할 {list.onShelf}권</b>
                  </span>
                )}
              </>
            ) : (
              "세는 중…"
            )}
          </span>
          {list && !audit && (
            <>
              <button
                type="button"
                disabled={listBusy}
                onClick={() => {
                  setAudit(new Map());
                  setAuditBooks({});
                  setAuditNote(null);
                  setTimeout(() => auditRef.current?.focus(), 50);
                }}
                className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                ✅ 대조 검사
              </button>
              <button
                type="button"
                disabled={listBusy}
                onClick={() => void resetShelf()}
                className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-50"
              >
                🔄 리셋
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setListOf(null);
              setList(null);
            }}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-slate-500 hover:bg-slate-100"
          >
            닫기
          </button>
        </div>

        {audit ? (
          (() => {
            /*
              ── 대조 검사 ───────────────────────────────────────────────
              칸을 비워 한 권씩 찍으면서, 기록과 손에 든 것을 맞춰 봅니다. 세 가지만 보면
              됩니다: 기록에 있는데 안 나온 책 · 나왔는데 기록에 없는 책 · 권수가 다른 책.
              대출 나간 책은 '안 나온' 쪽에 뜨는 게 정상이라 따로 표시해 둡니다.
            */
            const recorded = new Map((list?.rows ?? []).map((r) => [r.bookId, r]));
            const scannedCopies = [...audit.values()].reduce((n, c) => n + c, 0);
            const missing = (list?.rows ?? []).filter((r) => (audit.get(r.bookId) ?? 0) < r.copies);
            const extra = [...audit.entries()].filter(
              ([id, c]) => (recorded.get(id)?.copies ?? 0) < c
            );
            const same = (list?.rows ?? []).filter((r) => (audit.get(r.bookId) ?? 0) === r.copies);
            return (
              <>
                <div className="border-b border-slate-100 px-5 py-3">
                  <input
                    ref={auditRef}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = (e.target as HTMLInputElement).value;
                      (e.target as HTMLInputElement).value = "";
                      void auditScan(v);
                    }}
                    placeholder={`${listOf.code} 칸에서 꺼낸 책을 하나씩 찍으세요 — 아직 아무것도 바뀌지 않습니다`}
                    className="scan-input w-full rounded-xl border-2 border-dashed border-gia-gold bg-amber-50/50 px-4 py-3 text-center outline-none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-bold text-emerald-700">
                      찍음 {audit.size}종 · {scannedCopies}권
                    </span>
                    <span className="text-slate-400">
                      기록 {list?.titles ?? 0}종 · {list?.copies ?? 0}권
                    </span>
                    {auditNote && <span className="truncate text-xs text-slate-500">{auditNote}</span>}
                  </p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {/*
                    찍었는데 장서에 없는 책. 알리고 넘어가면 그 책은 손에 들려 있는데 할 수
                    있는 게 없습니다. 여기서 등록하면 바로 센 것으로 칩니다.
                  */}
                  {auditTodo.length > 0 && (
                    <section>
                      <p className="sticky top-0 bg-rose-600 px-5 py-1.5 text-xs font-bold text-white">
                        먼저 손봐야 합니다 — {auditTodo.length}개
                      </p>
                      <ul className="divide-y divide-slate-100">
                        {auditTodo.map((t) => (
                          <li key={t.code} className="px-5 py-2.5">
                            {t.kind === "unknown" ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="min-w-0 flex-1">
                                  <span className="block font-mono text-sm font-bold">{t.code}</span>
                                  <span className="block text-[11px] text-slate-500">
                                    장서에 없는 책입니다 —{" "}
                                    {t.isIsbn
                                      ? "등록하면 제목이 자동으로 채워집니다"
                                      : "등록하면 도서관 라벨을 새로 발급합니다"}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRegister(
                                      t.isIsbn
                                        ? { isbn: t.code, mode: "audit" }
                                        : { code: t.code, mode: "audit" }
                                    )
                                  }
                                  className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-bold text-white"
                                >
                                  📘 여기서 등록하기
                                </button>
                                <button
                                  type="button"
                                  onClick={() => dropTodo(t.code)}
                                  className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 underline"
                                >
                                  잘못 찍음
                                </button>
                              </div>
                            ) : (
                              <div>
                                <p className="text-sm font-bold">
                                  {t.books[0].title}
                                  <span className="ml-2 text-[11px] font-medium text-slate-500">
                                    같은 ISBN이 등급별로 {t.books.length}줄 — 어느 쪽인지 골라주세요
                                  </span>
                                </p>
                                <p className="mt-1.5 flex flex-wrap gap-1.5">
                                  {t.books.map((b) => (
                                    <button
                                      key={b.id}
                                      type="button"
                                      onClick={() => {
                                        countOne(b.id, b.title, b.label_level);
                                        dropTodo(t.code);
                                        auditRef.current?.focus();
                                      }}
                                      className="rounded-lg px-2.5 py-1 text-xs font-bold ring-1"
                                      style={{
                                        color: levelColor(b.label_level),
                                        borderColor: levelColor(b.label_level),
                                        background: `${levelColor(b.label_level)}14`,
                                      }}
                                    >
                                      {b.label_level != null ? `${b.label_level}등급` : "등급 없음"}
                                      {b.label_no ? ` ${b.label_no}` : ""}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => dropTodo(t.code)}
                                    className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 underline"
                                  >
                                    잘못 찍음
                                  </button>
                                </p>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {missing.length > 0 && (
                    <section>
                      <p className="sticky top-0 bg-amber-100 px-5 py-1.5 text-xs font-bold text-amber-900">
                        기록에 있는데 안 나왔습니다 — {missing.length}종
                      </p>
                      <ul className="divide-y divide-slate-100">
                        {missing.map((r) => (
                          <li key={r.bookId} className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm">
                            <span className="min-w-0 flex-1 truncate">{r.title}</span>
                            {r.onLoan > 0 && (
                              <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-bold text-sky-700">
                                📕 대출 중 {r.onLoan}권
                              </span>
                            )}
                            <span className="shrink-0 text-xs text-slate-500">
                              기록 {r.copies}권 · 찍음 {audit.get(r.bookId) ?? 0}권
                            </span>
                            {/*
                              알리고 끝내지 않습니다. 찾아서 꽂았으면 '찾았음', 이 칸 책이
                              아니었으면 '이 칸에서 빼기' - 둘 중 하나로 그 자리에서 끝납니다.
                              라벨이 뜯겨 못 찍는 책이 있어서 손으로 체크할 길이 필요합니다.
                            */}
                            <span className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  countOne(r.bookId, r.title, r.level);
                                  auditRef.current?.focus();
                                }}
                                className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-bold text-emerald-700"
                              >
                                ✔ 찾았음
                              </button>
                              <button
                                type="button"
                                disabled={listBusy}
                                onClick={() => void fixRow(r.bookId, "remove")}
                                className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-bold text-rose-700 disabled:opacity-40"
                              >
                                이 칸에서 빼기
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {extra.length > 0 && (
                    <section>
                      <p className="sticky top-0 bg-rose-100 px-5 py-1.5 text-xs font-bold text-rose-900">
                        나왔는데 기록보다 많습니다 — {extra.length}종
                      </p>
                      <ul className="divide-y divide-slate-100">
                        {extra.map(([id, c]) => (
                          <li key={id} className="flex items-center gap-3 px-5 py-2 text-sm">
                            <span className="min-w-0 flex-1 truncate">
                              {auditBooks[id]?.title ?? id}
                            </span>
                            <span className="shrink-0 text-xs text-slate-500">
                              기록 {recorded.get(id)?.copies ?? 0}권 · 찍음 {c}권
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <p className="px-5 py-3 text-xs text-slate-400">
                    맞는 책 {same.length}종. 다 찍으셨으면 아래에서 이 칸의 기록을 바꿉니다.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
                  {/*
                    손봐야 할 게 남아 있으면 맞추지 못하게 막습니다. 등록 안 된 책을 남겨 둔
                    채 맞추면 그 책은 아무 칸에도 없는 책이 되고, 다음에 책장을 통째로 다시
                    뒤지기 전에는 아무도 모릅니다.
                  */}
                  <button
                    type="button"
                    disabled={listBusy || audit.size === 0 || auditTodo.length > 0}
                    onClick={() => void applyAudit()}
                    className="rounded-xl bg-gia-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {auditTodo.length > 0
                      ? `먼저 ${auditTodo.length}개를 손봐주세요`
                      : `찍은 대로 맞추기 — ${audit.size}종 ${scannedCopies}권`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAudit(null);
                      setAuditNote(null);
                    }}
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 underline"
                  >
                    검사 그만두기
                  </button>
                  <span className="text-[11px] text-slate-400">
                    바꾸지 않고 그만둬도 됩니다 — 검사 중에는 아무것도 저장되지 않습니다.
                  </span>
                </div>
              </>
            );
          })()
        ) : (
          <>
            <p className="bg-amber-50 px-5 py-2.5 text-xs leading-relaxed text-amber-900">
              실제 책장과 권수가 다르면 여기서 고칩니다. <b>−1권</b>은 두 번 찍힌 것,{" "}
              <b>빼기</b>는 애초에 이 칸 책이 아니었던 것입니다. 어디서부터 어긋났는지 모르겠으면{" "}
              <b>✅ 대조 검사</b>로 칸을 비우고 다시 찍어 맞춰 보세요.
            </p>

            <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {list?.rows.map((r) => (
                <li key={r.bookId} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.title}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {r.author ?? ""}
                      {r.itemCode ? ` · ${r.itemCode}` : r.isbn ? ` · ${r.isbn}` : ""}
                    </span>
                  </span>
                  {/* 찍은 뒤에 빌려 나간 책입니다 - 기록에는 있고 책장에는 없습니다. */}
                  {r.onLoan > 0 && (
                    <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-bold text-sky-700">
                      📕 대출 {r.onLoan}
                    </span>
                  )}
                  {r.level != null && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold"
                      style={{
                        background: `${levelColor(r.level)}1f`,
                        color: levelColor(r.level),
                      }}
                    >
                      {r.level}
                      {r.labelNo ? ` ${r.labelNo}` : ""}
                    </span>
                  )}
                  <span
                    className={`w-12 shrink-0 text-right text-sm font-black ${
                      r.copies > 1 ? "text-amber-600" : "text-slate-500"
                    }`}
                  >
                    {r.copies}권
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      disabled={listBusy}
                      onClick={() => void fixRow(r.bookId, "minus")}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700 disabled:opacity-40"
                    >
                      −1권
                    </button>
                    <button
                      type="button"
                      disabled={listBusy}
                      onClick={() => void fixRow(r.bookId, "remove")}
                      className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-bold text-rose-700 disabled:opacity-40"
                    >
                      빼기
                    </button>
                  </span>
                </li>
              ))}
              {list && list.rows.length === 0 && (
                <li className="px-5 py-10 text-center text-sm text-slate-400">
                  이 칸에 적힌 책이 없습니다.
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );

  // ── 칸 고르기 ────────────────────────────────────────────────────────────
  if (!here) {
    return (
      <div className="space-y-4">
        {listPanel}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-bold">자리 등록</h1>
          <p className="mt-1 text-sm text-slate-500">
            책장 한 칸을 통째로 빼서 하나씩 찍으면, 그 책들의 자리가 이 칸으로 바뀝니다.
            <b className="text-slate-700"> 새로 등록하는 화면이 아닙니다</b> — 이미 등록된 책의
            자리를 고치는 화면입니다.
          </p>
          <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            시리즈별 정렬은 여기서 하지 않습니다. <b>자리가 다 잡힌 뒤</b> 「② 정리 계획」에서
            분류해 옮길 자리를 정하고 「③ 정리 실행」으로 옮기면 됩니다. 지금은 무엇이 어디에
            있는지만 사실대로 적는 단계입니다.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p className="mb-3 text-sm font-bold text-slate-500">지금 비울 칸을 고르세요</p>
          {locations.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              아직 만든 칸이 없습니다. 「① 구역 관리」에서 칸을 먼저 만들어주세요.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {locations.map((loc) => {
                const seen = checked[loc.id];
                return (
                  <li
                    key={loc.id}
                    className="rounded-xl px-3 py-3 ring-1"
                    style={{ background: `${loc.color}14`, borderColor: loc.color }}
                  >
                    <span className="block text-xl font-black" style={{ color: loc.color }}>
                      {loc.code}
                    </span>
                    {loc.name && (
                      <span className="block truncate text-xs text-slate-500">{loc.name}</span>
                    )}
                    {/*
                      이미 확인한 칸이라고 적어 둡니다. 여럿이 나눠 하거나 며칠에 걸쳐 할 때
                      어디까지 했는지 모르면 같은 칸을 두 번 돌게 됩니다.
                    */}
                    <span className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                      {loc.label_level != null && (
                        <span
                          className="rounded px-1 py-0.5 font-black"
                          style={{
                            color: levelColor(loc.label_level),
                            background: `${levelColor(loc.label_level)}1f`,
                          }}
                        >
                          {loc.label_level}등급
                        </span>
                      )}
                      {seen ? `${seen.titles}종 · ${seen.copies}권` : "아직 안 함"}
                      {loc.checked_done_at && (
                        <span className="rounded bg-emerald-50 px-1 py-0.5 font-bold text-emerald-700">
                          ✅ 다 찍음
                        </span>
                      )}
                    </span>
                    {/*
                      찍으러 들어가는 길과 들여다보는 길을 갈라 둡니다. 숫자가 이상할 때
                      칸을 고르면 곧바로 찍기 화면으로 들어가 버리면, 확인하려다 실수로
                      한 권 더 찍게 됩니다.
                    */}
                    <span className="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setHere(loc);
                          setDone([]);
                          setResult(null);
                        }}
                        className="flex-1 rounded-lg bg-white/80 px-2 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-300 hover:bg-white"
                      >
                        📷 등록
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadList(loc)}
                        disabled={!seen}
                        className="flex-1 rounded-lg bg-white/80 px-2 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-300 hover:bg-white disabled:opacity-40"
                      >
                        📋 목록보기
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ── 찍기 ────────────────────────────────────────────────────────────────
  const seen = checked[here.id];

  return (
    <div className="space-y-4">
      {stale && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-rose-600 px-5 py-3 text-white">
          <span className="min-w-0 flex-1 text-sm font-bold">
            새 버전 v{stale} 이 나왔습니다 — 이 화면은 v{APP_VERSION} 입니다.
            <span className="block text-xs font-normal opacity-90">
              새로고침하기 전에는 새로 생긴 버튼이 안 보입니다. 찍은 것은 이미 저장돼 있으니
              지금 눌러도 잃는 것은 없습니다.
            </span>
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-white px-4 py-2 text-sm font-black text-rose-700"
          >
            ↻ 새로고침
          </button>
        </div>
      )}
      {listPanel}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">지금 비우는 칸</p>
          <p className="flex items-center gap-2 text-3xl font-black" style={{ color: here.color }}>
            {here.code}
            {/* 이 칸의 등급. 적혀 있으면 자리 등록은 다른 등급이 나올 때만 말합니다. */}
            {here.label_level != null && (
              <span
                className="rounded-lg px-2 py-0.5 text-sm font-black"
                style={{
                  color: levelColor(here.label_level),
                  background: `${levelColor(here.label_level)}1f`,
                }}
              >
                {here.label_level}등급
              </span>
            )}
            {here.name && (
              <span className="text-base font-semibold text-slate-500">{here.name}</span>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-slate-400">이번에 찍음</p>
            <p className="text-2xl font-black text-emerald-600">{done.length}권</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">이 칸 누적</p>
            <p className="text-2xl font-black text-slate-700">{seen?.copies ?? 0}권</p>
          </div>
          {/*
            이 칸을 다 비웠다는 표시. 숫자로는 알 수 없는 것이라 사람이 눌러야 합니다.
            이게 켜져야 그 등급을 정리해도 되는지 계획 화면이 판단할 수 있습니다.
          */}
          <button
            type="button"
            onClick={() => void markDone(here, !here.checked_done_at)}
            className={`rounded-lg px-3 py-2 text-sm font-bold ${
              here.checked_done_at
                ? "bg-emerald-600 text-white"
                : "border border-emerald-400 text-emerald-700 hover:bg-emerald-50"
            }`}
          >
            {here.checked_done_at ? "✅ 다 찍음" : "이 칸 다 찍었습니다"}
          </button>
          <button
            type="button"
            onClick={() => void loadList(here)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            📋 이 칸 목록
          </button>
          <button
            type="button"
            onClick={() => setCamera((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {camera ? "카메라 끄기" : "📷 카메라"}
          </button>
          <button
            type="button"
            onClick={() => {
              setHere(null);
              setResult(null);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            칸 바꾸기
          </button>
        </div>
      </div>

      {camera ? (
        <BarcodeScanner
          continuous
          onDetect={(text) => handleTyped(text)}
          accept={(text) => isBookBarcode(text)}
          hint={`${here.code} 칸에서 뺀 책을 하나씩 대세요`}
        />
      ) : (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleTyped(value);
              setValue("");
            }
          }}
          placeholder={
            busy ? "읽는 중… 다시 찍지 마세요" : `여기에 커서를 두고 ${here.code} 칸의 책을 찍으세요`
          }
          /*
            처리 중에는 찍어도 받지 않습니다(두 번 세어지는 것보다 한 번 놓치는 쪽이 낫습니다).
            그래서 처리 중이라는 것이 눈에 보여야 합니다 - 안 보이면 사람이 "안 먹었나" 하고
            한 번 더 찍고, 그게 두 번 세어진 바로 그 경로입니다.

            disabled 가 아니라 readOnly 인 이유: disabled 로 막으면 커서가 입력칸에서 떨어지고,
            다시 돌아오기까지 최대 0.7초가 걸립니다. 그 사이에 찍은 것은 아무 데도 안 들어갑니다.
            readOnly 는 커서를 그대로 둔 채 글자만 안 받습니다.
          */
          readOnly={busy}
          className={`scan-input w-full rounded-2xl border-2 border-dashed px-4 py-4 text-center text-lg outline-none focus:border-gia-gold focus:bg-white ${
            busy
              ? "animate-pulse border-amber-400 bg-amber-50 text-amber-700"
              : "border-slate-300 bg-slate-50"
          }`}
          autoComplete="off"
          spellCheck={false}
        />
      )}

      {note && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
          {note}
        </p>
      )}

      {result && (
        <ResultPanel
          result={result}
          here={here}
          busy={busy}
          onPick={(bookId) => void send({ bookId })}
          onMove={(bookId) => void send({ bookId, confirm: "move" })}
          onAdd={(bookId) => void send({ bookId, confirm: "add" })}
          onHome={(bookId) => void send({ bookId, confirm: "home" })}
          onFixCount={(bookId) => void send({ bookId, confirm: "recount" })}
          onRelocate={(bookId, targetBookId, targetLocationId) =>
            void send({ bookId, confirm: "relocate", targetBookId, targetLocationId })
          }
          onLevel={(bookId, level, levelScope) =>
            void send({ bookId, confirm: "level", level, levelScope })
          }
          onRegister={(code, isbnLike) =>
            setRegister(isbnLike ? { isbn: code, mode: "place" } : { code, mode: "place" })
          }
          onSkip={() => setResult(null)}
          onStash={(bookId) => void stash(bookId)}
          onSplit={(book) => void split(book)}
        />
      )}

      {/*
        등록이 끝나면 **그 자리에서 이 칸에 꽂습니다.** 등록만 해 두고 자리를 안 적으면 다음
        사람이 또 못 찾습니다 - 지금 손에 들고 있을 때 끝내는 게 맞습니다.
      */}
      <BookRegisterDialog
        open={register !== null}
        initialIsbn={register?.isbn}
        initialScanCode={register?.code}
        onClose={() => {
          setRegister(null);
          inputRef.current?.focus();
        }}
        onCreated={(book: LibBook) => {
          const where = register?.mode ?? "place";
          const code = register?.isbn ?? register?.code ?? "";
          setRegister(null);
          if (where === "audit") {
            /*
              검사 중에는 쓰지 않습니다 - 센 것으로만 칩니다. 기록이 바뀌는 것은 다 세고
              '찍은 대로 맞추기'를 누를 때 한 번뿐이라는 약속을 여기서도 지킵니다.
            */
            countOne(book.id, book.title, book.label_level);
            if (code) dropTodo(code);
            setTimeout(() => auditRef.current?.focus(), 50);
            return;
          }
          void send({ bookId: book.id });
          inputRef.current?.focus();
        }}
      />

      {done.length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-bold text-slate-500">
            {here.code} 칸에 적은 책 {done.length}권
          </p>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {done.map((item) => (
              <li key={item.key} className="flex items-center gap-2 px-4 py-2.5">
                {item.warned && <span title="확인할 것이 있습니다">⚠</span>}
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                {item.level != null && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold"
                    style={{
                      background: `${levelColor(item.level)}1f`,
                      color: levelColor(item.level),
                    }}
                  >
                    {item.level}등급
                  </span>
                )}
                {item.copiesHere > 1 && (
                  <span className="shrink-0 text-xs font-bold text-slate-500">
                    {item.copiesHere}권째
                  </span>
                )}
                <span className="shrink-0 text-xs text-slate-400">
                  {item.split ? "나뉘어 있음" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void undo(item)}
                  className="shrink-0 text-xs text-slate-400 hover:text-red-500"
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pile && pile.count > 0 && (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
          📥 인쇄 대기 {pile.count}장 — 칸을 다 돌고 「인쇄 기록」에서 한꺼번에 뽑으세요.
        </p>
      )}
    </div>
  );
}

/* ── 찍은 결과 한 장 ─────────────────────────────────────────────────────── */
function ResultPanel(props: ResultPanelProps) {
  // 결과가 바뀌면 접어 둔 것도 초기화됩니다(key 로 새 컴포넌트가 됩니다).
  return <ResultBody key={props.result.kind + (("book" in props.result && props.result.book.id) || "")} {...props} />;
}

type ResultPanelProps = Parameters<typeof ResultBody>[0];

function ResultBody({
  result,
  here,
  busy,
  onPick,
  onMove,
  onAdd,
  onHome,
  onFixCount,
  onRelocate,
  onLevel,
  onRegister,
  onSkip,
  onStash,
  onSplit,
}: {
  result: ShelfCheckResult;
  here: LibLocation;
  busy: boolean;
  onPick: (bookId: string) => void;
  onMove: (bookId: string) => void;
  onAdd: (bookId: string) => void;
  onHome: (bookId: string) => void;
  /** 장서에 적힌 권수를 찍어서 센 만큼으로 그 자리에서 맞춥니다. */
  onFixCount: (bookId: string) => void;
  /** 이 한 권을 같은 제목의 다른 줄·칸으로 넘깁니다. */
  onRelocate: (bookId: string, targetBookId: string, targetLocationId: string) => void;
  /** 등급을 그 자리에서 나누거나(한 권만) 고칩니다(줄 전체). */
  onLevel: (bookId: string, level: number, scope: "copy" | "row") => void;
  /** 등록 안 된 책을 이 화면에서 바로 등록합니다. */
  onRegister: (code: string, isIsbn: boolean) => void;
  onSkip: () => void;
  onStash: (bookId: string) => void;
  onSplit: (book: LibBookWithShelf) => void;
}) {
  /*
    '여기 그냥 두기'가 실제로 끝나는 동작이 되려면 그 안내가 사라져야 합니다. 누르고도
    그대로 남아 있으면 끝낸 것인지 아닌지 알 수 없고, 다음 책을 찍을 때까지 눈에 걸립니다.
  */
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const hide = (i: number) => setHidden((prev) => new Set(prev).add(i));
  /** 등급 단추를 눌러 고른 값. 무엇을 할지(한 권만 / 줄 전체)는 그 다음에 고릅니다. */
  const [levelPick, setLevelPick] = useState<number | null>(null);
  /** 등급 고치기를 펼쳤는지. 평소에는 접혀 있습니다 - 매번 묻지 않기 위해서입니다. */
  const [levelOpen, setLevelOpen] = useState(false);

  if (result.kind === "placed") {
    /*
      ── '옮김' 이라고 쓸 수 있는 때 ────────────────────────────────────
      책에 적어 두는 자리(대표 자리)가 바뀐 것과, 책이 실제로 옮겨 간 것은 다른 일입니다.
      이 줄이 다른 칸에도 여전히 세어져 있으면 **옮긴 것이 아니라 나뉘어 있는 것**이고,
      바뀐 것은 대표 자리 한 칸뿐입니다. 그걸 '이 칸으로 옮김'이라고 적어 두면 "3-3 있던
      걸 3-4로 옮겨버렸다"로 읽힙니다 - 3-3 의 한 권은 그대로 있는데도요.
    */
    const splitAcross = result.otherShelves.length > 0;
    return (
      <div className="gia-pop rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start gap-4">
          {result.book.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.book.cover_url}
              alt=""
              className="h-24 w-18 shrink-0 rounded object-cover ring-1 ring-slate-200"
            />
          ) : (
            <span className="flex h-24 w-18 shrink-0 items-center justify-center rounded bg-slate-100 text-3xl">
              📘
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xl font-bold break-words">{result.book.title}</p>
            <p className="truncate text-sm text-slate-500">{result.book.author ?? ""}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              {result.book.label_level != null && (
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-bold"
                  style={{
                    background: `${levelColor(result.book.label_level)}1f`,
                    color: levelColor(result.book.label_level),
                  }}
                >
                  {result.book.label_level}등급
                  {result.book.label_no ? ` ${result.book.label_no}` : ""}
                </span>
              )}
              <span className="font-mono text-xs text-slate-400">
                {result.book.item_code ?? formatIsbn(result.book.isbn)}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-slate-400">
              {splitAcross ? "이 칸에도" : "이 칸"}
            </p>
            <p className="text-5xl leading-none font-black" style={{ color: here.color }}>
              {here.code}
            </p>
            {result.copiesHere > 1 && (
              <p className="mt-1 text-sm font-bold text-slate-500">
                이 칸에서 {result.copiesHere}권째
              </p>
            )}
            {/*
              요청: "두 권째 찍히면 3권 중 2권이 2-1에 있다고 표시해주고, 한 권 더 찍으면
              3/3으로 표기." 묻지 않는 대신 이 숫자가 사람에게 "이 칸은 다 나왔다"를
              알려줍니다. 한 권짜리 책에는 셀 것이 없으니 띄우지 않습니다.
            */}
            {result.recordedCopies > 1 && (
              <p
                className={`mt-1 text-sm font-bold ${
                  result.foundTotal >= result.recordedCopies ? "text-emerald-600" : "text-slate-400"
                }`}
              >
                {result.foundTotal >= result.recordedCopies
                  ? `${result.foundTotal}/${result.recordedCopies} 다 찾음`
                  : `${result.recordedCopies}권 중 ${result.foundTotal}권`}
              </p>
            )}
          </div>
        </div>

        {/*
          ── 등급 고치기 ────────────────────────────────────────────────
          요청: "라벨 등급이 다른가요는 매번 묻지 말고, 부득이하게 한 칸에 다른 등급의 책을
          넣어야 할 때 설정할 수 있도록 만들어줘."

          칸에 등급이 적혀 있으면 서버가 **다를 때만** 안내를 보냅니다. 여기 있는 것은 그
          밖의 드문 경우를 위한 접힌 길입니다 - 평소에는 작은 글씨 한 줄일 뿐이고, 눌러야
          펼쳐집니다. 찍는 사람 눈앞에 늘 떠 있으면 그것도 묻는 것과 같습니다.
        */}
        {levelOpen ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
            <span className="text-xs font-bold text-slate-500">
              이 책의 등급
              <span className="ml-1 font-normal text-slate-400">
                지금 {result.book.label_level != null ? `${result.book.label_level}등급` : "등급 없음"}
              </span>
            </span>
            {[2, 3, 4, 5, 6].map((lv) => (
              <button
                key={lv}
                type="button"
                disabled={busy || lv === result.book.label_level}
                onClick={() => setLevelPick(lv === levelPick ? null : lv)}
                className={`rounded-lg px-2.5 py-1 text-xs font-black ring-1 disabled:opacity-30 ${
                  levelPick === lv ? "ring-2" : ""
                }`}
                style={{
                  color: levelColor(lv),
                  borderColor: levelColor(lv),
                  background: levelPick === lv ? `${levelColor(lv)}2f` : `${levelColor(lv)}14`,
                }}
              >
                {lv}
              </button>
            ))}
            {/*
              찾은 권수가 장서에 적힌 것보다 **모자랄 때**도 고칠 수 있어야 합니다. 넘칠
              때만 버튼을 내주면, "2권이라고 적혀 있는데 실은 1권"인 책은 끝내 못 고칩니다.
            */}
            {result.foundTotal !== result.recordedCopies && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onFixCount(result.book.id)}
                className="rounded-lg border border-amber-400 bg-white px-2.5 py-1 text-xs font-bold text-amber-800 disabled:opacity-50"
              >
                🧮 장서를 찾은 {result.foundTotal}권으로
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setLevelOpen(false);
                setLevelPick(null);
              }}
              className="ml-auto text-xs font-semibold text-slate-400 underline"
            >
              접기
            </button>
            {levelPick != null && (
              <span className="flex w-full flex-wrap gap-1.5 pt-1.5">
                {/*
                  둘을 가르는 것은 "이 책 전부가 그 등급이냐, 지금 든 한 권만 그 등급이냐"입니다.
                  같은 책이라도 등급이 나뉘면 자료도 두 줄이어야 합니다.
                */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onLevel(result.book.id, levelPick, "copy");
                    setLevelPick(null);
                    setLevelOpen(false);
                  }}
                  className="rounded-lg bg-gia-navy px-3 py-1.5 text-left text-xs font-bold text-white disabled:opacity-50"
                >
                  📗 이 권만 {levelPick}등급으로 떼기
                  <span className="block text-[10px] font-medium opacity-80">
                    {levelPick}등급 줄로 한 권 옮깁니다 — 없으면 새로 만듭니다
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onLevel(result.book.id, levelPick, "row");
                    setLevelPick(null);
                    setLevelOpen(false);
                  }}
                  className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-left text-xs font-bold text-slate-700 disabled:opacity-50"
                >
                  ✏️ 이 줄 전체를 {levelPick}등급으로
                  <span className="block text-[10px] font-medium opacity-70">
                    {result.book.total_copies}권 모두 — 등급이 잘못 적혀 있던 경우
                  </span>
                </button>
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLevelOpen(true)}
            className="mt-3 text-xs font-semibold text-slate-400 underline"
          >
            등급 · 권수를 고쳐야 하나요?
          </button>
        )}

        {/* 예전과 다른 점 · 봐야 할 것들. 없으면 아무것도 안 뜹니다(조용한 게 정상입니다). */}
        {result.notices.length > 0 && (
          <ul className="mt-4 space-y-2">
            {result.notices.map((n, i) => (hidden.has(i) ? null : (
              <li
                key={i}
                className={`rounded-xl px-4 py-3 text-sm ring-1 ${
                  n.tone === "warn"
                    ? "bg-amber-50 text-amber-900 ring-amber-200"
                    : "bg-slate-50 text-slate-700 ring-slate-200"
                }`}
              >
                <p className="font-bold">
                  {n.tone === "warn" ? "⚠ " : ""}
                  {n.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed opacity-90">{n.detail}</p>
                {n.action === "labeled" && (
                  <button
                    type="button"
                    onClick={() => onStash(result.book.id)}
                    className="mt-2 rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-bold text-white"
                  >
                    📥 라벨 인쇄 대기에 넣기
                  </button>
                )}
                {/* 예전의 '🏠 ○○ 칸으로 보내기'는 뺐습니다 — 모으는 일은 정리 단계에서 한 번에 합니다. */}
                {n.action === "level" && n.levelTo != null && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onLevel(result.book.id, n.levelTo!, "copy")}
                      className="rounded-lg bg-gia-navy px-3 py-1.5 text-left text-xs font-bold text-white disabled:opacity-50"
                    >
                      📗 이 권만 {n.levelTo}등급으로
                      <span className="block text-[10px] font-medium opacity-80">
                        이 칸 등급으로 한 권만 뗍니다
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onLevel(result.book.id, n.levelTo!, "row")}
                      className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-left text-xs font-bold text-slate-700 disabled:opacity-50"
                    >
                      ✏️ 이 줄 전체를 {n.levelTo}등급으로
                      <span className="block text-[10px] font-medium opacity-70">
                        {result.book.total_copies}권 모두
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => hide(i)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600"
                    >
                      ✋ 일부러 섞어 둔 칸입니다 — 그대로
                    </button>
                  </span>
                )}
                {/* '📦 ○○ 칸으로 보내기'도 같은 이유로 뺐습니다 — 지금은 찍는 대로 적기만 합니다. */}
                {n.action === "split" && (
                  <button
                    type="button"
                    onClick={() => onSplit(result.book)}
                    className="mt-2 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-800"
                  >
                    ✂ {result.book.total_copies}줄로 따로 떼기
                  </button>
                )}
              </li>
            )))}
          </ul>
        )}
      </div>
    );
  }

  if (result.kind === "again") {
    /*
      같은 책이 이 칸에 또 있는 것인지, 손이 미끄러져 두 번 찍힌 것인지는 사람만 압니다.
      다만 적힌 권수 안에서는 묻지 않습니다 - 3권짜리 책이 세 권 나오는 것은 새로운 사실이
      아니고, 한 칸에 서른 권을 찍는 사람에게 그 물음은 곧 일입니다. 이 카드는 적힌 권수를
      **넘겼을 때만** 뜹니다. 그때가 기록이 틀렸다는 뜻이고, 사람이 책을 손에 들고 있을 때만
      확인해 줄 수 있는 유일한 순간입니다.
    */
    return (
      <div className="gia-pop rounded-3xl bg-amber-50 p-6 ring-1 ring-amber-300">
        <p className="text-sm font-bold text-amber-700">{result.message}</p>
        <p className="mt-1 text-xl font-bold text-amber-950">{result.book.title}</p>
        <p className="mt-1 text-xs text-amber-800">
          장서에 {result.recordedCopies}권 · 지금까지 {result.foundTotal}권 찾음
          {result.copiesHere > 0 && ` (${result.locationCode}에 ${result.copiesHere}권)`}
          {result.copiesHere === 0 && result.homeCode && ` (${result.homeCode}에 있던 책)`}
        </p>
        {/*
          같은 칸에서 또 찍힌 것과, 다른 칸에 세어 둔 책이 여기서 나온 것은 묻는 말이 다릅니다.
          뒤의 경우는 "그 칸 책이 옮겨 온 거냐, 거기 것과 별개의 한 권이냐"입니다.
        */}
        <p className="mt-3 text-sm text-amber-900">
          {result.copiesHere === 0 && result.homeCode ? (
            <>
              <b>{result.homeCode}</b> 칸에 세어 둔 책입니다. 지금 손에 든 이 책이{" "}
              <b>거기 있던 그 책</b>인가요, <b>기록에 없던 또 한 권</b>인가요?
            </>
          ) : (
            <>
              적힌 권수는 이미 다 찾았습니다. 지금 손에 든 책이 <b>아까 그 책</b>인가요,{" "}
              <b>기록에 없던 한 권</b>인가요?
            </>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {/*
            ① 자리이동 — 같은 책 한 권입니다. 센 권수를 올리면 없는 책이 한 권 생깁니다.
          */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove(result.book.id)}
            className="rounded-xl border border-amber-400 bg-white px-4 py-2.5 text-left text-sm font-bold text-amber-900 disabled:opacity-50"
          >
            📍 자리이동
            <span className="block text-[11px] font-medium opacity-75">
              {result.copiesHere === 0 && result.homeCode
                ? `${result.homeCode}에서 가져온 그 책 · 거기서 한 권 뺍니다`
                : "같은 책입니다 · 권수는 그대로"}
            </span>
          </button>
          {/*
            ② 장서추가 — 장서에 적힌 권수가 실제보다 적었던 경우입니다. 손에 들고 확인한
            사람이 올리는 것이므로 그 자리에서 반영합니다.
          */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdd(result.book.id)}
            className="rounded-xl bg-amber-600 px-4 py-2.5 text-left text-sm font-bold text-white disabled:opacity-50"
          >
            ➕ 장서추가 — {result.foundTotal + 1}권째
            <span className="block text-[11px] font-medium opacity-85">
              장서도 {result.recordedCopies} → {result.recordedCopies + 1}권
            </span>
          </button>
          {/*
          {/* '🏠 ○○ 칸으로'도 뺐습니다 — 지금 한 권씩 옮기면 그 책은 두 번 손을 탑니다. */}
          <button
            type="button"
            onClick={onSkip}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-amber-800 underline"
          >
            잘못 찍었습니다
          </button>
        </div>
      </div>
    );
  }

  if (result.kind === "choices") {
    return (
      <div className="gia-pop rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="mb-3 text-sm font-bold text-slate-500">{result.message}</p>
        <ul className="space-y-2">
          {result.books.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(b.id)}
                className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-left hover:bg-slate-100 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{b.title}</span>
                  <span className="block truncate text-xs text-slate-500">{b.author ?? ""}</span>
                </span>
                {b.label_level != null ? (
                  <span
                    className="shrink-0 rounded px-2 py-1 text-sm font-bold"
                    style={{
                      background: `${levelColor(b.label_level)}1f`,
                      color: levelColor(b.label_level),
                    }}
                  >
                    {b.label_level}등급
                    {b.label_no ? ` ${b.label_no}` : ""}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-slate-400">등급 없음</span>
                )}
                <span className="shrink-0 text-xs text-slate-400">
                  {b.shelf ? b.shelf.code : "자리없음"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.kind === "unknown") {
    return (
      <div className="gia-pop rounded-3xl bg-rose-50 p-6 ring-1 ring-rose-300">
        <p className="text-xl font-black text-rose-900">{result.message}</p>
        <p className="mt-1 font-mono text-sm text-rose-700">
          {result.isIsbn ? formatIsbn(result.code) : result.code}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-rose-900">{result.detail}</p>
        {/*
          여기서 등록하고, 등록이 끝나면 이 칸에 바로 꽂습니다. 창을 옮겨 다니면 들고 있던
          책을 내려놓게 되고 어디까지 찍었는지도 흐려집니다.

          ISBN이 아닌 바코드는 등록 창이 도서관 라벨을 새로 발급해 줍니다 - 찍힌 번호는
          '상품코드'로만 남겨 두므로, 같은 번호를 쓰는 다른 책과 한 줄로 합쳐지지 않습니다.
        */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onRegister(result.code, result.isIsbn)}
            className="rounded-xl bg-rose-600 px-4 py-2.5 text-left text-sm font-bold text-white disabled:opacity-50"
          >
            📘 여기서 등록하기
            <span className="block text-[11px] font-medium opacity-85">
              {result.isIsbn
                ? "제목을 자동으로 채운 뒤 이 칸에 바로 꽂습니다"
                : "도서관 라벨을 새로 발급하고 이 칸에 바로 꽂습니다"}
            </span>
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-rose-800 underline"
          >
            건너뛰기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gia-pop rounded-3xl bg-slate-800 p-6 text-white">
      <p className="text-lg font-bold">{result.message}</p>
      {result.detail && <p className="mt-1 text-sm opacity-80">{result.detail}</p>}
    </div>
  );
}
