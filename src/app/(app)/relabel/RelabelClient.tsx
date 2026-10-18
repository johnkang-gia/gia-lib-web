"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Barcode from "@/components/Barcode";
import CoverShot from "@/components/CoverShot";
import { beep, setSoundOn, soundOn } from "@/lib/beep";
import { canonicalIsbn, isIsbn, isValidIsbn, normalizeIsbn, normalizeScan } from "@/lib/scan";
import type { LibBook } from "@/lib/types";

/**
 * 재등록 — 상품코드로 들어가 있는 책을 ISBN 으로 바꿔 적고 라벨을 담습니다.
 *
 * ── 이 화면의 순서 ─────────────────────────────────────────────────────────
 * ① 책에 인쇄된 바코드를 찍습니다(그게 상품코드입니다).
 * ② 화면이 그 번호가 무엇인지 말해 줍니다 — 상품코드로 등록된 줄인지, 이미 ISBN 줄인지,
 *    아예 등록이 안 된 번호인지.
 * ③ 상품코드면 **표지의 ISBN 13자리**를 적습니다. 손에 책을 들고 있는 그 순간이 이걸 알 수
 *    있는 유일한 순간입니다.
 * ④ 적으면 그 정보로 교체등록하고 **모아뽑기**에 라벨을 담습니다.
 * ⑤ 다 찍은 뒤 「라벨 뽑기」 한 번.
 *
 * ── 왜 한 권씩 묻는가 ─────────────────────────────────────────────────────
 * 상품코드는 '상품 한 줄'이라 전집 열두 권이 같은 번호입니다. 자동으로는 어느 권인지 알 수
 * 없습니다 - 표지를 보는 사람만 압니다. 그래서 묻고, 적는 즉시 그 한 권이 자기 줄을 갖습니다.
 *
 * ── 바꾼 결과를 **전 → 후**로 펼쳐 보여줍니다 ─────────────────────────────
 * 요청: "뭐로 바뀌었는지에 대한 정보가 재등록에는 나오지 않아서 제대로 등록이 되는지를
 * 모르겠어. 기존 책이 어떻게 다시 등록되는 건지 알 수 있도록 만들어줘. 페이지 공간 충분히
 * 사용해서 만들어줘."
 *
 * 맞는 말입니다. 「바꿨습니다」 한 줄만 보여주는 화면은 사람에게 **믿어달라고** 말하는
 * 화면입니다. 손에 책을 들고 번호를 적는 사람이 확인해야 하는 것은 세 가지입니다 -
 * 제목이 그 책이 맞나, 권수가 어긋나지 않았나, 라벨에 찍힐 번호가 표지의 번호인가.
 * 그래서 바꾸기 전과 후를 나란히 놓고, **달라진 칸만 색으로** 표시하고, 라벨에 실제로 들어갈
 * 바코드를 그려 둡니다. 눈으로 대보면 끝나는 일을 화면이 대신 주장하게 두지 않습니다.
 */

/** 이 책이 책장등록에서 몇 권 나왔는지. 「한 권 더인지」를 묻는 근거입니다. */
type ShelfCounts = { copies: number; shelf: number; rows: number; loansOut: number };

/** 이 책이 지금 어디 있는지 — 정해 둔 자리가 먼저, 없으면 책장등록에서 나온 칸. */
type Place = { checks: { code: string; copies: number }[] };

/** 등록 전에 보여 주는 책 정보 — 사람이 보고 누릅니다. */
type Preview = {
  title: string;
  author: string | null;
  publisher: string | null;
  pubYear: string | null;
  coverUrl: string | null;
  source: string | null;
  choices: { title: string; source: string }[];
};

/** 이 줄에 붙어 있는 번호들(서버의 RowCodes 와 같습니다). */
type RowCodes = {
  scanned: string;
  isbn: string | null;
  sameIsbn: boolean;
  itemCode: string | null;
  productCode: string | null;
  labelPrints: string | null;
};

type Found =
  | { kind: "product"; book: LibBook; message: string }
  | {
      kind: "isbn";
      book: LibBook;
      message: string;
      counts: ShelfCounts;
      place: Place;
      codes: RowCodes;
    }
  | { kind: "new"; code: string; isProduct: boolean; message: string; preview: Preview | null }
  | { kind: "error"; message: string; detail?: string };

/** 바꾸기 전 그 줄의 모습. */
type Before = {
  title: string;
  code: string | null;
  isbn: string | null;
  copies: number;
  level: number | null;
  locationId: string | null;
  shelf: string | null;
};

/** 바꾼 뒤 그 한 권이 들어간 줄. */
type After = {
  id: string;
  title: string;
  isbn: string | null;
  code: string | null;
  productCode: string | null;
  copies: number;
  level: number | null;
  author: string | null;
  publisher: string | null;
  coverUrl: string | null;
  shelf: string | null;
};

/** 조회처 한 곳이 답한 제목. 서로 다를 때 사람이 고릅니다. */
type TitleChoice = {
  title: string;
  source: string;
  author: string | null;
  publisher: string | null;
  pubYear: string | null;
  coverUrl: string | null;
};

type ApplyResult = {
  what: string;
  message: string;
  foundBy: string | null;
  before: Before | null;
  after: After | null;
  /** 여러 권 줄에서 한 권을 뗀 경우, 남은 권수가 어느 번호로 얼마나 남았는지. */
  leftover: { code: string | null; copies: number } | null;
  /** 라벨에 실제로 찍힐 번호. */
  barcode: string;
  logId: string | null;
  /** 찍은 번호(화면이 들고 있습니다). */
  scanned: string;
  /** 제목을 준 조회처. */
  titleFrom: string | null;
  /** 조회처에서 못 찾아 원래(상자) 제목이 그대로 남았는지. */
  titleKept: boolean;
  /** 조회처마다 답한 제목들. */
  titleChoices: TitleChoice[];
};

type RecentRow = {
  id: string;
  code: string;
  isbn: string | null;
  what: string;
  at: string;
  undoneAt: string | null;
  canUndo: boolean;
  beforeTitle: string | null;
  beforeCopies: number | null;
  /** 바꾼 뒤 그 한 권이 들어간 책의 지금 제목(기록이 아니라 책에서 읽은 것). */
  afterTitle: string | null;
};

/** 상품코드 책이 몇 권 남았고 몇 권을 바꿨는지. 종이 아니라 **권**으로 셉니다. */
type Progress = {
  leftRows: number;
  leftCopies: number;
  doneCopies: number;
  totalCopies: number;
  left: { id: string; title: string; code: string | null; isbn: string | null; copies: number; level: number | null }[];
  recent: RecentRow[];
  /** 등록조차 안 되어 있던 책을 새로 넣은 권수. */
  createdCopies: number;
  /** 책장등록에 없던 한 권을 장서에 더한 권수. */
  addedCopies: number;
};

const WHAT_KO: Record<string, string> = {
  replaced: "줄을 그대로 고쳐 씀",
  split: "여러 권 줄에서 한 권 떼어냄",
  moved: "이미 있던 ISBN 줄로 보냄",
  created: "새로 등록",
  addcopy: "장서에 한 권 더함(책장 밖에 있던 권)",
  pending: "책장등록 대기로 적어 둠",
};

export default function RelabelClient() {
  const [scan, setScan] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [scanned, setScanned] = useState("");
  const [isbn, setIsbn] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [editIsbn, setEditIsbn] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  /** ISBN 이 없거나 조회가 안 되는 책을 제목으로 등록하는 자리. */
  const [byTitle, setByTitle] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [pile, setPile] = useState<{ id: string; count: number } | null>(null);
  /** 모아뽑기에 담긴 책들(담긴 차례). 잘못 담은 것을 빼려면 보여야 합니다. */
  const [pileBooks, setPileBooks] = useState<{ id: string; title: string; code: string | null; count: number }[]>([]);
  const [showPile, setShowPile] = useState(false);
  /** 이미 뽑은 묶음들(기록). 프린터가 씹었을 때 다시 뽑거나 되담을 수 있어야 합니다. */
  const [printed, setPrinted] = useState<
    { id: string; title: string; count: number; at: string | null }[]
  >([]);
  const [showPrinted, setShowPrinted] = useState(false);
  /** 이미 ISBN 줄인 책에 라벨을 새로 뽑을지(책에 인쇄된 바코드를 그대로 쓸지). */
  const [wantLabel, setWantLabel] = useState(true);
  const [prog, setProg] = useState<Progress | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  /** 소리로 알려줄지. 책을 보는 동안 화면을 안 봐도 되게 합니다. */
  const [sound, setSound] = useState(true);
  /** 이미 등록된 줄에 ISBN 을 적어 넣는 칸. */
  const [isbnFix, setIsbnFix] = useState(false);
  /** 바코드가 없는 책 — 손으로 치는 번호 칸(늘 보입니다). */
  const [bareIsbn, setBareIsbn] = useState("");
  /**
   * 번호를 **손으로 쳐 넣었는지**(= 책에 바코드가 없다는 뜻).
   *
   * 찍어서 들어온 번호면 그 책에는 쓸 수 있는 바코드가 이미 인쇄되어 있습니다 - 라벨은
   * 같은 번호를 한 번 더 붙이는 일입니다. 손으로 친 번호면 책에 바코드가 없다는 뜻이라
   * 라벨이 있어야 합니다. 같은 "등록되지 않은 ISBN"이라도 둘은 다릅니다.
   */
  const [typedEntry, setTypedEntry] = useState(false);
  /** 표지 사진으로 제목 찾기. */
  const [shooting, setShooting] = useState(false);
  const [shotBusy, setShotBusy] = useState(false);
  const [shotTitle, setShotTitle] = useState<string | null>(null);
  const [shotBooks, setShotBooks] = useState<
    { title: string; author: string | null; publisher: string | null; isbn: string | null; cover_url: string | null }[]
  >([]);
  const scanRef = useRef<HTMLInputElement>(null);
  const isbnRef = useRef<HTMLInputElement>(null);

  const loadProgress = useCallback(async () => {
    try {
      const j = (await (await fetch("/api/books/relabel")).json()) as Progress & { error?: string };
      if (!j.error) {
        setProg(j);
        /*
          남은 줄이 몇 개뿐이면 **접어 두지 않습니다.** 그게 남은 일의 전부인데 접혀 있으면,
          이미 끝난 책을 들고 와서 찍고 「이미 등록된 책입니다」를 다시 보게 됩니다.
        */
        if (j.leftRows > 0 && j.leftRows <= 10) setShowLeft(true);
      }
    } catch {
      // 진행 숫자를 못 읽어도 재등록은 할 수 있습니다.
    }
  }, []);

  const loadPile = useCallback(async () => {
    try {
      const j = (await (await fetch("/api/print-jobs/pile")).json()) as {
        pile?: { id: string } | null;
        count?: number;
        books?: { id: string; title: string; code: string | null; count: number }[];
      };
      setPile(j.pile ? { id: j.pile.id, count: j.count ?? 0 } : null);
      setPileBooks(j.books ?? []);
    } catch {
      // 모아뽑기를 못 읽어도 재등록은 할 수 있습니다.
    }
  }, []);

  const loadPrinted = useCallback(async () => {
    try {
      const j = (await (await fetch("/api/print-jobs", { cache: "no-store" })).json()) as {
        jobs?: { id: string; kind: string; title: string; targets: string[]; signature: string; printed_at: string | null }[];
      };
      setPrinted(
        (j.jobs ?? [])
          .filter((x) => x.kind === "labels" && x.signature?.startsWith("printed:"))
          .slice(0, 8)
          .map((x) => ({ id: x.id, title: x.title, count: x.targets?.length ?? 0, at: x.printed_at }))
      );
    } catch {
      // 기록을 못 읽어도 재등록은 할 수 있습니다.
    }
  }, []);

  useEffect(() => {
    void loadPile();
    void loadProgress();
    void loadPrinted();
    setSound(soundOn());
  }, [loadPile, loadProgress, loadPrinted]);

  /** 소리 한 번(꺼 두었으면 조용히 넘어갑니다). */
  const say = useCallback((kind: "ok" | "ask" | "bad") => beep(kind, sound), [sound]);

  /*
    스캐너는 키보드처럼 글자를 쏟습니다. 커서가 찍는 칸에 있어야 들어갑니다. 다만 ISBN 을
    적는 중에는 빼앗아 오지 않습니다 - 사람이 숫자를 치고 있는 칸입니다.
  */
  useEffect(() => {
    const waitingIsbn = found?.kind === "product" || (found?.kind === "new" && found.isProduct);
    const id = setInterval(() => {
      if (editing) return;
      if (waitingIsbn) {
        if (document.activeElement?.tagName !== "INPUT") isbnRef.current?.focus();
      } else if (document.activeElement?.tagName !== "INPUT") {
        scanRef.current?.focus();
      }
    }, 700);
    if (!editing) (waitingIsbn ? isbnRef : scanRef).current?.focus();
    return () => clearInterval(id);
  }, [found, editing]);

  async function doFind(raw: string, typed = false) {
    const code = normalizeScan(raw);
    if (!code || busy) return;
    setTypedEntry(typed);
    setBusy(true);
    setNote(null);
    setFound(null);
    setIsbn("");
    setByTitle(false);
    setNewTitle("");
    setShotTitle(null);
    setShotBooks([]);
    setShooting(false);
    setIsbnFix(false);
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "find", code }),
      });
      const j = (await res.json()) as Found & { error?: string };
      if (j.error) {
        setNote(j.error);
        say("bad");
      } else {
        setScanned(code);
        setFound(j);
        /*
          찍은 뒤 **눈을 들어야 하는지**를 소리로 알립니다. 이 화면에서 찍은 것은 거의 항상
          사람에게 물을 거리를 만듭니다(어느 권이냐, 같은 책이냐, 이 책이 맞냐) - 그래서
          기본은 「봐야 한다」 소리입니다.
        */
        say("ask");
        /*
          ── 라벨을 꼭 뽑아야 하는 책과 아닌 책 ─────────────────────────────
          요청: "이미 ISBN 등록된 책들은 라벨을 모아뽑기에 등록할 건지, 아니면 지금 코드가
          이미 ISBN 코드니까 기존 코드를 그냥 사용할 건지도 물어봐주고."

          맞는 말입니다. 책 뒤에 ISBN 바코드가 인쇄되어 있고 장서도 그 번호로 들고 있으면,
          라벨은 **같은 번호를 한 번 더 붙이는 일**입니다. 종이도 손도 아깝습니다.

          그래서 기본값을 책에 따라 정합니다 - 쓸 수 있는 바코드가 이미 있으면 「그대로
          쓰기」, 도서관 라벨 번호(GIA-B-…)로 들고 있는 책이면 「뽑기」. 어느 쪽이든 화면에서
          바꿀 수 있습니다.
        */
        /*
          ── 라벨이 필요한 경우는 둘뿐입니다 ──────────────────────────────────
          "이미 ISBN 바코드가 있기 때문에 그걸로 찍었고, 그렇기 때문에 그냥 ISBN 바코드를
          등록하면 되기 때문이야. 바코드가 필요한 건 바코드가 아예 없거나, 상품목록 바코드일
          경우야."

          그대로입니다. 책에 인쇄된 바코드가 **그 책 한 권을 가리키면** 라벨은 같은 번호를 한
          번 더 붙이는 일입니다. 라벨이 필요한 경우는
            · 바코드가 아예 없는 책   - 찍을 것이 없어 번호를 손으로 쳤습니다.
            · 상품코드 바코드인 책     - 그 번호는 열두 권을 한꺼번에 가리킵니다.
          뿐입니다.
        */
        if (j.kind === "isbn") {
          const own = [j.book.item_code, j.book.isbn].filter(Boolean) as string[];
          const scanIsOwn =
            !typed &&
            own.some(
              (v) =>
                v.toUpperCase() === code.toUpperCase() ||
                (isIsbn(v) && isIsbn(code) && canonicalIsbn(v) === canonicalIsbn(code))
            );
          setWantLabel(!scanIsOwn);
        } else if (j.kind === "new") {
          /*
            찍어서 들어온 ISBN 이면 그 책에는 쓸 수 있는 바코드가 이미 있습니다 - 라벨을 다시
            뽑을 이유가 없습니다. 손으로 친 번호면 바코드가 없다는 뜻이라 라벨이 필요합니다.
          */
          setWantLabel(j.isProduct || typed || !isValidIsbn(code));
        } else {
          setWantLabel(true);
        }

        /*
          ── 찍은 번호가 ISBN 그 자체이면 ─────────────────────────────────
          번호를 다시 적게 할 이유는 없지만, **말없이 등록하지도 않습니다.** 잘못 찍은 번호,
          남의 책, 선물 받은 책이 섞여 들어옵니다. 조회만 해 두고 무엇이 등록될지 보여준 뒤
          사람이 누르게 합니다(아래 '등록할까요?' 카드).
        */
        /*
          이미 등록된 책이어도 **그냥 라벨만 담지 않습니다.**

          지금 찍는 책들은 책장에서 빼내어 따로 모아 둔 것이라, 장서에 있다는 사실만으로는
          손에 든 이 한 권이 책장등록 때 이미 센 그 책인지, 그때 못 센 또 한 권인지 알 수
          없습니다. 둘은 권수가 한 권 다릅니다 - 그래서 묻습니다(아래 화면).
        */
      }
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setScan("");
      setBareIsbn("");
    }
  }

  /** 모아뽑기에 한 장 담거나(add) 한 장 뺍니다(remove). */
  async function addToPile(bookId: string, remove?: string) {
    try {
      const res = await fetch("/api/print-jobs/pile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: bookId ? [bookId] : [],
          ...(remove ? { remove: [remove] } : {}),
        }),
      });
      const j = (await res.json()) as { count?: number; pile?: { id: string } | null; error?: string };
      if (j.error) {
        setNote(`모아뽑기에 담지 못했습니다: ${j.error}`);
        return;
      }
      setPile(j.pile ? { id: j.pile.id, count: j.count ?? 0 } : null);
      void loadPile();
    } catch {
      setNote("모아뽑기에 담지 못했습니다.");
    }
  }

  async function doApply(over?: { code?: string; isbn?: string; bookId?: string; title?: string }) {
    if (busy) return;
    const code = over?.code ?? scanned;
    const useIsbn = over?.isbn ?? isbn;
    if (!over && !found) return;
    const bookId = over ? over.bookId : found?.kind === "product" ? found.book.id : undefined;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          code,
          isbn: useIsbn,
          bookId,
          // 적어 둔 제목이 있으면 함께 보냅니다(ISBN 이 없거나 조회가 안 되는 책).
          title: over?.title ?? (byTitle ? newTitle.trim() : undefined),
        }),
      });
      const j = (await res.json()) as Partial<ApplyResult> & {
        book?: LibBook | null;
        error?: string;
        /** 조회처가 이 번호를 모릅니다 - 제목을 적을 자리를 바로 열어 줍니다. */
        needTitle?: boolean;
      };
      if (j.error || !j.after) {
        setNote(j.error ?? "바꾸지 못했습니다.");
        if (j.needTitle) setByTitle(true);
        say(j.needTitle ? "ask" : "bad");
        return;
      }
      setResult({
        what: j.what ?? "",
        message: j.message ?? "",
        foundBy: j.foundBy ?? null,
        before: j.before ?? null,
        after: j.after,
        leftover: j.leftover ?? null,
        barcode: j.barcode ?? "",
        logId: j.logId ?? null,
        scanned: code,
        titleFrom: j.titleFrom ?? null,
        titleKept: Boolean(j.titleKept),
        titleChoices: j.titleChoices ?? [],
      });
      say("ok");
      if (wantLabel) await addToPile(j.after.id);
      void loadProgress();
      setFound(null);
      setScanned("");
      setIsbn("");
      setEditing(false);
      setByTitle(false);
      setNewTitle("");
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * **되돌리기** — 바꾸기 전으로 돌립니다.
   *
   * 라벨도 함께 뺍니다. 되돌렸는데 모아뽑기에 그 라벨이 남아 있으면, 나중에 뽑은 종이에
   * 붙일 곳 없는 라벨이 한 장 섞입니다.
   */
  async function doUndo(logId: string, labelId?: string) {
    if (busy || !logId) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", logId }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (j.error) {
        setNote(j.error);
        return;
      }
      say("ok");
      if (labelId) await addToPile("", labelId);
      setNote(j.message ?? "되돌렸습니다.");
      if (result?.logId === logId) setResult(null);
      setEditing(false);
      void loadProgress();
      void loadPile();
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * **넘기기** — 방금 찍은 것을 아무 일도 없던 것으로 하고 다음 책으로 갑니다.
   *
   * 잘못 찍거나, 자리를 확인하러 갔다가 다시 찍는 일이 생깁니다. 그때 빠져나갈 길이 없으면
   * 사람은 둘 중 하나를 **아무거나 누릅니다** - 그 순간 권수가 틀어집니다. 아무것도 바꾸지
   * 않는 버튼이 눈에 보이는 자리에 있어야 합니다.
   */
  function doSkip() {
    setFound(null);
    setScanned("");
    setIsbn("");
    setByTitle(false);
    setNewTitle("");
    setNote("넘겼습니다 — 아무것도 바꾸지 않았습니다.");
    scanRef.current?.focus();
  }

  /** 책장등록에 없던 한 권을 장서에 더하고 라벨을 담습니다. */
  async function doAddCopy(book: LibBook) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addcopy", code: scanned, bookId: book.id }),
      });
      const j = (await res.json()) as Partial<ApplyResult> & { error?: string };
      if (j.error || !j.after) {
        setNote(j.error ?? "장서에 더하지 못했습니다.");
        return;
      }
      setResult({
        what: j.what ?? "addcopy",
        message: j.message ?? "",
        foundBy: null,
        before: j.before ?? null,
        after: j.after,
        leftover: null,
        barcode: j.barcode ?? "",
        logId: j.logId ?? null,
        scanned,
        titleFrom: null,
        titleKept: false,
        titleChoices: [],
      });
      say("ok");
      if (wantLabel) await addToPile(j.after.id);
      setFound(null);
      setScanned("");
      void loadProgress();
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 장서에 이미 세어져 있는 그 책입니다 — 권수는 건드리지 않습니다(라벨은 고른 대로).
   *
   * 책장등록에 없는 책이면 **「책장등록 대기」로 한 줄 적어 둡니다.** 그러지 않으면 넘긴
   * 순간 그 책은 어디에도 남지 않고, 라벨만 붙인 채 자리 등록을 잊으면 장서에는 있는데
   * 책장에는 없는 책으로 영영 남습니다.
   */
  /**
   * **상품코드 떼기** — 라벨을 책에 실제로 붙인 뒤.
   *
   * 재등록은 상품코드를 지우지 않고 옮겨 둡니다 - 라벨을 붙이기 전까지 책은 아직 상품코드로
   * 찍히니까요. 붙인 그 순간에 이 버튼을 누르면 번호가 하나로 정리됩니다.
   */
  async function dropProduct(book: LibBook) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dropproduct", bookId: book.id }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (j.error) {
        setNote(j.error);
        say("bad");
        return;
      }
      setNote(`${book.title} — ${j.message ?? "상품코드를 뗐습니다"}`);
      say("ok");
      setFound(null);
      setScanned("");
      void loadProgress();
    } finally {
      setBusy(false);
    }
  }

  async function doLabelOnly(book: LibBook, pending = false) {
    if (busy) return;
    setBusy(true);
    try {
      if (pending) {
        await fetch("/api/books/relabel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pending", bookId: book.id, code: scanned }),
        }).catch(() => null);
      }
      say("ok");
      if (wantLabel) await addToPile(book.id);
      setNote(
        wantLabel
          ? `${book.title} — 장서에 이미 있는 책으로 두고 라벨만 담았습니다(숫자 그대로).`
          : `${book.title} — 장서에 이미 있는 책이고 책 바코드를 그대로 씁니다. 아무것도 바꾸지 않았습니다.`
      );
      setFound(null);
      setScanned("");
    } finally {
      setBusy(false);
    }
  }

  /**
   * **표지 사진으로 제목 찾기** — 바코드도 ISBN 도 없는 책의 유일한 단서는 표지입니다.
   *
   * 읽어낸 제목을 그대로 넣지 않고 **그 제목으로 찾은 책 후보**까지 받아 고르게 합니다.
   * 후보를 고르면 ISBN 까지 붙으므로, 라벨을 붙인 뒤부터는 바코드가 인쇄된 책과 똑같이
   * 찍힙니다 - 제목만 넣으면 그 책은 영원히 '제목만 있는 책'으로 남습니다.
   */
  async function readShot(dataUrl: string) {
    setShotBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const j = (await res.json()) as {
        read?: { title: string | null };
        candidates?: {
          title: string;
          author: string | null;
          publisher: string | null;
          isbn: string | null;
          cover_url: string | null;
        }[];
        error?: string;
      };
      if (!res.ok || !j.read) {
        setNote(j.error ?? "표지를 읽지 못했습니다.");
        say("bad");
        return;
      }
      setShotTitle(j.read.title ?? null);
      setShotBooks(j.candidates ?? []);
      if (j.read.title) {
        setByTitle(true);
        setNewTitle(j.read.title);
      }
      setShooting(false);
      say("ask");
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
      say("bad");
    } finally {
      setShotBusy(false);
    }
  }

  /**
   * **ISBN 적어 넣기** — 이미 등록된 줄에 표지의 ISBN 을 붙입니다.
   *
   * 라벨 번호나 상품코드만 들고 있던 책, 제목만 적어 등록한 책에 ISBN 이 생깁니다. 손에
   * 책을 들고 있는 지금이 그 번호를 적을 수 있는 유일한 순간입니다.
   */
  async function doSetIsbn(book: LibBook, value: string) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setisbn", bookId: book.id, isbn: value }),
      });
      const j = (await res.json()) as { after?: After; message?: string; error?: string };
      if (j.error || !j.after) {
        setNote(j.error ?? "적어 넣지 못했습니다.");
        say("bad");
        return;
      }
      setNote(`${j.after.title} — ${j.message ?? "ISBN을 적어 넣었습니다"}`);
      say("ok");
      setIsbnFix(false);
      setIsbn("");
      // 바뀐 모습으로 다시 찍은 것처럼 보여줍니다(라벨을 담을지도 다시 고를 수 있게).
      await doFind(scanned);
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
      say("bad");
    } finally {
      setBusy(false);
    }
  }

  /**
   * **뽑았습니다 — 기록으로 넘기기.**
   *
   * 모아둔 자리는 *지금 뽑을 것*을 담는 곳입니다. 뽑고도 그대로 두면 다음에 담는 라벨이 그
   * 위에 쌓여서, 다음 종이에 **이미 붙인 라벨이 함께** 나옵니다. 그렇다고 비워 버리면 프린터가
   * 씹었을 때 다시 뽑을 길이 없습니다 - 그래서 비우지 않고 기록으로 넘깁니다.
   */
  async function doneWithPile() {
    if (busy || !pile || pile.count === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/print-jobs/pile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: true }),
      });
      const j = (await res.json()) as { message?: string; error?: string };
      if (j.error) {
        setNote(j.error);
        return;
      }
      setNote(j.message ?? "뽑은 기록으로 넘겼습니다.");
      say("ok");
      setShowPile(false);
      await loadPile();
      await loadPrinted();
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** 뽑은 묶음을 다시 모아뽑기에 담습니다(프린터가 씹었을 때). */
  async function rePile(jobId: string) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const got = (await (await fetch(`/api/print-jobs`, { cache: "no-store" })).json()) as {
        jobs?: { id: string; targets: string[] }[];
      };
      const job = (got.jobs ?? []).find((x) => x.id === jobId);
      if (!job || job.targets.length === 0) {
        setNote("그 기록을 찾지 못했습니다.");
        return;
      }
      const res = await fetch("/api/print-jobs/pile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: job.targets }),
      });
      const j = (await res.json()) as { count?: number; error?: string };
      if (j.error) {
        setNote(`되담지 못했습니다: ${j.error}`);
        return;
      }
      setNote(`${job.targets.length}장을 모아뽑기에 되담았습니다.`);
      await loadPile();
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** 모아뽑기에서 한 장(또는 그 책 전부) 뺍니다. */
  async function removeFromPile(bookId: string, all = false, times = 1) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/print-jobs/pile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: [], remove: all ? Array(times).fill(bookId) : [bookId] }),
      });
      const j = (await res.json()) as { count?: number; pile?: { id: string } | null; error?: string };
      if (j.error) {
        setNote(`빼지 못했습니다: ${j.error}`);
        return;
      }
      setPile(j.pile ? { id: j.pile.id, count: j.count ?? 0 } : null);
      void loadPile();
    } finally {
      setBusy(false);
    }
  }

  /**
   * **제목 고치기** — 화면의 제목이 손에 든 책과 다를 때 그 자리에서 고칩니다.
   *
   * 조회처는 틀립니다. 어느 쪽이 맞는지는 표지를 보고 있는 사람만 압니다 - 그 사람을
   * 「장서 관리」로 보내면 대개 고쳐지지 않습니다.
   */
  async function doSetTitle(title: string, from?: TitleChoice) {
    if (busy || !result?.after || !title.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settitle",
          bookId: result.after.id,
          title,
          // 조회처를 바꾼 것이면 저자·출판사·표지도 그 책의 것으로 함께 갑니다.
          author: from?.author ?? null,
          publisher: from?.publisher ?? null,
          pubYear: from?.pubYear ?? null,
          coverUrl: from?.coverUrl ?? null,
        }),
      });
      const j = (await res.json()) as { after?: After; message?: string; error?: string };
      if (j.error || !j.after) {
        setNote(j.error ?? "제목을 고치지 못했습니다.");
        return;
      }
      setResult((prev) =>
        prev
          ? { ...prev, after: j.after as After, titleKept: false, titleFrom: from?.source ?? "직접 적음" }
          : prev
      );
      setTitleEditing(false);
      setNote(j.message ?? null);
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** **수정** — 되돌린 뒤 다른 ISBN 으로 다시 등록합니다(한 번에). */
  async function doRedo() {
    if (busy || !result?.logId) return;
    const next = normalizeIsbn(editIsbn);
    if (![10, 13].includes(next.length)) return;
    setBusy(true);
    setNote(null);
    const oldLabel = result.after?.id;
    try {
      const res = await fetch("/api/books/relabel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "redo", logId: result.logId, isbn: editIsbn }),
      });
      const j = (await res.json()) as Partial<ApplyResult> & { error?: string };
      if (j.error || !j.after) {
        setNote(j.error ?? "다시 등록하지 못했습니다.");
        return;
      }
      setResult({
        what: j.what ?? "",
        message: j.message ?? "",
        foundBy: j.foundBy ?? null,
        before: j.before ?? null,
        after: j.after,
        leftover: j.leftover ?? null,
        barcode: j.barcode ?? "",
        logId: j.logId ?? null,
        scanned: result.scanned,
        titleFrom: j.titleFrom ?? null,
        titleKept: Boolean(j.titleKept),
        titleChoices: j.titleChoices ?? [],
      });
      /*
        잘못 담긴 라벨을 빼고 새 라벨을 담습니다.

        같은 줄로 다시 들어가더라도 **빼고 담습니다.** 처음에 한 번 걸렸습니다 - 같은 줄이면
        뺄 것이 없다고 보고 담기만 했더니 모아뽑기에 같은 라벨이 두 장이 됐습니다. 복본은
        권수만큼 라벨이 필요하므로 같은 id 가 여러 장 들어 있는 것이 정상이고, 그래서 화면이
        "이미 있으니 넘어가자"고 판단해서는 안 됩니다.
      */
      await addToPile(j.after.id, oldLabel ?? undefined);
      setEditing(false);
      setEditIsbn("");
      void loadProgress();
    } catch (e) {
      setNote(`보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /*
    ISBN 을 **물어야 하는** 경우만 입력칸을 냅니다. 찍은 것이 이미 ISBN 이면 물을 것이
    없습니다 - 그때는 「이 책이 맞나요?」 카드를 냅니다.
  */
  const waitingIsbn = found?.kind === "product" || (found?.kind === "new" && found.isProduct);
  const askRegister = found?.kind === "new" && !found.isProduct;
  const recent = prog?.recent ?? [];
  const liveRecent = recent.filter((r) => !r.undoneAt);

  /*
    ── 표지 사진으로 제목 찾기 ──────────────────────────────────────────────
    바코드도 ISBN 도 없는 책의 단서는 표지뿐입니다. 사진을 찍으면 제목을 읽고 **그 제목으로
    찾은 책 후보**까지 보여줍니다. 후보를 고르면 ISBN 이 함께 붙어서, 라벨을 붙인 뒤부터는
    바코드가 인쇄된 책과 똑같이 찍힙니다.
  */
  const coverBlock = (
    <div className="mt-2">
      {!shooting && (
        <button
          type="button"
          onClick={() => setShooting(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          📷 표지 찍어 제목 넣기
        </button>
      )}
      {shooting && (
        <div className="mt-2">
          <CoverShot onShot={(url) => void readShot(url)} busy={shotBusy} onClose={() => setShooting(false)} />
        </div>
      )}
      {shotTitle && (
        <p className="mt-2 text-xs text-slate-600">
          표지에서 읽은 제목: <b>{shotTitle}</b> — 위 칸에 넣어 두었습니다. 아래 후보 중 손에 든 책이 있으면 누르세요
          (ISBN까지 함께 들어갑니다).
        </p>
      )}
      {shotBooks.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {shotBooks.map((b, i) => (
            <button
              key={`${b.isbn ?? "none"}-${i}`}
              type="button"
              disabled={busy}
              onClick={() =>
                void doApply({ code: scanned, isbn: b.isbn ?? "", title: b.title })
              }
              className="flex gap-2 rounded-lg border border-slate-300 bg-white p-2 text-left hover:border-gia-gold disabled:opacity-50"
            >
              {b.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.cover_url} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
              ) : (
                <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded bg-slate-100 text-lg">
                  📘
                </div>
              )}
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">{b.title}</span>
                <span className="block text-xs text-slate-500">
                  {[b.author, b.publisher].filter(Boolean).join(" · ")}
                </span>
                {b.isbn && <span className="block font-mono text-xs text-slate-400">{b.isbn}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex items-start gap-3">
        <h1 className="text-xl font-bold text-gia-navy">재등록 · 라벨 뽑기</h1>
        <button
          type="button"
          onClick={() => {
            const next = !sound;
            setSound(next);
            setSoundOn(next);
            // 켠 순간 한 번 들려줍니다 - 켜졌는지 확인하려고 책을 찍어 볼 수는 없으니까요.
            if (next) beep("ok", true);
          }}
          className={`ml-auto rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
            sound ? "border-gia-gold bg-amber-50 text-gia-navy" : "border-slate-300 text-slate-500"
          }`}
          title="찍을 때마다 소리로 알려줍니다 — 됐다 / 봐야 한다 / 안 됐다"
        >
          {sound ? "🔊 소리 켬" : "🔇 소리 끔"}
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        책에 인쇄된 바코드를 찍으세요. 상품코드로 등록된 책이면 <b>표지의 ISBN</b>을 적는 자리가 나오고, 적으면 그 정보로
        바꿔 적은 뒤 <b>모아뽑기</b>에 라벨을 담습니다. 바꾼 결과는 아래에 <b>전 → 후</b>로 펼쳐 둡니다 — 제목·권수·라벨 번호를
        눈으로 대보고 다음 책을 찍으세요.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        상품코드는 &lsquo;책 한 권&rsquo;이 아니라 &lsquo;상품 한 줄&rsquo;을 가리켜서, 전집은 열두 권이 같은 번호입니다. 어느 권인지는 표지를
        보는 사람만 알 수 있어서 한 권씩 묻습니다 — 같은 번호를 또 찍으면 또 한 권이 떨어져 나옵니다.
      </p>

      {/* ── 얼마나 남았나 ──────────────────────────────────────────────── */}
      {prog && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm text-slate-600">상품코드로 등록된 책</span>
            <span className="text-lg font-bold text-gia-navy">{prog.totalCopies}권</span>
            <span className="text-sm text-slate-400">중</span>
            <span className="text-lg font-bold text-emerald-700">{prog.doneCopies}권</span>
            <span className="text-sm text-slate-600">바꿨습니다</span>
            <span className="ml-auto text-sm font-semibold text-amber-700">
              남은 {prog.leftCopies}권
              {prog.leftRows > 0 && <span className="font-normal text-slate-500"> ({prog.leftRows}줄)</span>}
            </span>
          </div>
          <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-300"
              style={{
                width: `${prog.totalCopies > 0 ? Math.round((prog.doneCopies / prog.totalCopies) * 100) : 0}%`,
              }}
            />
          </div>
          {/*
            종이 아니라 권으로 세는 이유를 적어 둡니다. 「8줄 중 1줄」로 보면 거의 안 줄어드는
            것처럼 보이는데, 실제로 손이 가는 일은 권 단위입니다.
          */}
          {/*
            진행 막대는 상품코드 더미만 셉니다(끝이 보이는 숫자니까요). 그런데 손이 한 일은
            그것만이 아닙니다 - 새로 등록한 책, 책장에 없던 한 권. 안 보이면 "내가 한 일의
            절반이 어디 갔나"가 됩니다.
          */}
          {(prog.createdCopies > 0 || prog.addedCopies > 0) && (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-600">
              <span>그 밖에</span>
              {prog.createdCopies > 0 && (
                <span>
                  새로 등록 <b className="text-gia-navy">{prog.createdCopies}권</b>
                </span>
              )}
              {prog.addedCopies > 0 && (
                <span>
                  책장에 없던 한 권 더함 <b className="text-gia-navy">{prog.addedCopies}권</b>
                </span>
              )}
              <span className="text-xs text-slate-500">
                — 상품코드 더미에서 뺀 것이 아니라서 위 막대에는 들어가지 않습니다
              </span>
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            한 권 재등록할 때마다 남은 권수가 하나 줄어듭니다. 같은 상품코드에 여러 권이 묶여 있으면 그 줄은
            권수만 줄고 남아 있다가, 마지막 한 권까지 바꾸면 사라집니다.
          </p>
          {prog.leftCopies === 0 ? (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              상품코드로 남은 책이 없습니다 — 전부 교체됐습니다.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowLeft((v) => !v)}
                className="mt-2 text-xs font-semibold text-gia-navy underline"
              >
                {showLeft ? "남은 목록 접기" : `남은 ${prog.leftRows}줄 보기`}
              </button>
              {showLeft && (
                <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                  {prog.left.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                      <span className="font-mono text-xs text-slate-500">{b.code}</span>
                      <span className="font-semibold text-slate-800">{b.title}</span>
                      <span className="ml-auto text-xs text-amber-700">{b.copies}권 남음</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 찍는 칸 ─────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <input
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void doFind(scan);
            }
          }}
          placeholder={busy ? "읽는 중…" : "여기에 커서를 두고 책 바코드를 찍으세요 (ISBN 숫자를 쳐 넣고 Enter 도 됩니다)"}
          className={`w-full rounded-2xl border-2 border-dashed px-4 py-4 text-center text-lg outline-none focus:border-gia-gold focus:bg-white ${
            busy ? "animate-pulse border-amber-400 bg-amber-50 text-amber-700" : "border-slate-300 bg-slate-50"
          }`}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/*
        ── 찍을 바코드가 없는 책 ─────────────────────────────────────────────
        요청: "바코드는 없고 ISBN만 숫자로 적혀 있는 게 있어서 그래. 심지어 ISBN도 없는 경우도
        있어서, 그때는 책 표지를 찍어서 등록할 수 있도록." · "여기서 등록하기가 아니라 그냥
        숫자 넣을 수 있는 칸을 만들고 옆에 등록 버튼을 만들어서."

        칸을 접어 두지 않습니다. 펼치는 버튼을 한 번 더 누르게 하면, 급할 때는 그 칸이
        없는 것과 같습니다 - 번호를 칠 자리는 늘 보여야 합니다.
      */}
      {!found && !result && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-sm font-semibold text-slate-700">바코드가 없는 책</span>
            <input
              value={bareIsbn}
              onChange={(e) => setBareIsbn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void doFind(bareIsbn, true);
                }
              }}
              placeholder="책에 적힌 ISBN 숫자 (978… 또는 10자리, 끝이 X여도 됩니다)"
              className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base tracking-wider outline-none focus:border-gia-gold"
              autoComplete="off"
            />
            <button
              type="button"
              disabled={busy || ![10, 13].includes(normalizeIsbn(bareIsbn).length)}
              onClick={() => void doFind(bareIsbn, true)}
              className="rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              등록
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => {
                setShooting(true);
                setShotTitle(null);
                setShotBooks([]);
                setNewTitle("");
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
            >
              📷 번호도 없습니다 — 표지 찍기
            </button>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            번호를 치고 <b>등록</b>을 누르면 어떤 책인지 보여주고 등록할지 묻습니다(이미 등록된 책이면 그 책이
            뜹니다). 번호가 아예 없으면 표지를 찍으세요 — 후보를 고르면 <b>ISBN까지</b> 붙고, 맞는 후보가 없으면
            읽어낸 제목으로 등록하면서 <b>도서관 라벨 번호</b>를 발급합니다.
          </p>

          {(shooting || shotTitle || shotBooks.length > 0) && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {coverBlock}
              {(shotTitle || newTitle) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void doApply({ code: "", isbn: "", title: newTitle.trim() });
                      }
                    }}
                    placeholder="표지에 적힌 제목"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-gia-gold"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={busy || newTitle.trim().length === 0}
                    onClick={() => void doApply({ code: "", isbn: "", title: newTitle.trim() })}
                    className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    이 제목으로 등록 + 라벨 담기
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {note && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}

      {/* ── 찍은 결과 ───────────────────────────────────────────────────── */}
      {found && found.kind !== "error" && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">찍힌 번호 {scanned}</div>
              <p className="mt-1 text-sm font-semibold text-gia-navy">{found.message}</p>
            </div>
            {/* 잘못 찍었거나 확인하고 다시 찍을 때 빠져나가는 길. */}
            <button
              type="button"
              onClick={doSkip}
              className="ml-auto shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600"
              title="아무것도 바꾸지 않고 다음 책으로"
            >
              ✕ 넘기기
            </button>
          </div>

          {"book" in found && (
            <div className="mt-2 text-sm text-slate-700">
              <b>{found.book.title}</b>
              <span className="ml-2 text-xs text-slate-500">
                {found.book.label_level != null ? `${found.book.label_level}등급 · ` : ""}
                보유 {found.book.total_copies}권
                {found.book.isbn ? ` · ISBN ${found.book.isbn}` : ""}
              </span>
            </div>
          )}

          {waitingIsbn && (
            <div className="mt-3">
              <label className="text-xs font-semibold text-slate-600">
                표지에 적힌 ISBN 13자리
                {"book" in found && found.book.total_copies > 1 && (
                  <span className="ml-1 font-normal text-amber-700">
                    — 지금 손에 든 그 한 권의 번호입니다
                  </span>
                )}
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  ref={isbnRef}
                  value={isbn}
                  onChange={(e) => setIsbn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void doApply();
                    }
                  }}
                  /*
                    inputMode="numeric" 을 뺐습니다. 10자리 ISBN 의 마지막 자리는 **X** 일 수
                    있는데(067988338X), 숫자 자판에는 X 가 없습니다.
                  */
                  placeholder="978… 또는 10자리(끝이 X여도 됩니다)"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base tracking-wider outline-none focus:border-gia-gold"
                  autoComplete="off"
                />
                <button
                  type="button"
                  /*
                    ── X 를 숫자가 아니라고 떼면 안 됩니다 ───────────────────
                    실제로 걸렸습니다. 「067988338X」를 적었는데 버튼이 꺼져 있었습니다 - 이
                    조건이 \D(숫자 아닌 것)를 지워서 9자리로 셌기 때문입니다. 10자리 ISBN 의
                    마지막 자리는 체크숫자이고, 10 을 뜻할 때 **X** 로 적습니다.

                    서버는 이 값을 제대로 받습니다(067988338X → 9780679883388). 막고 있던 것은
                    화면뿐이었습니다.
                  */
                  disabled={
                    busy ||
                    (![10, 13].includes(normalizeIsbn(isbn).length) &&
                      !(byTitle && newTitle.trim().length > 0))
                  }
                  onClick={() => void doApply()}
                  className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "바꾸는 중…" : "교체등록 + 라벨 담기"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                ISBN 바코드가 아니라 <b>숫자</b>를 보고 적으세요. 체크숫자가 맞지 않으면 받지 않습니다 — 한 자리 잘못 적힌 책은
                나중에 바코드로도 제목으로도 찾히지 않습니다.
              </p>

              {/*
                ── ISBN 이 없는 책 ────────────────────────────────────────────
                오래된 책, 교구에 딸려 온 책, 바코드 자리가 뜯긴 책에는 ISBN 이 없습니다.
                조회처가 그 번호를 모르는 경우도 있습니다. 예전에는 둘 다 「여러 권 등록
                화면으로 가세요」로 돌려보냈는데, 손에 책을 들고 선 사람에게 다른 화면으로
                가라고 하면 그 책은 대개 그냥 책장으로 돌아갑니다. 그래서 여기서 끝냅니다.
              */}
              <button
                type="button"
                onClick={() => {
                  setByTitle((v) => !v);
                  setNewTitle("");
                }}
                className="mt-2 text-xs font-semibold text-gia-navy underline"
              >
                {byTitle ? "제목으로 등록 접기" : "ISBN이 없거나 조회가 안 되나요? — 제목으로 등록"}
              </button>

              {byTitle && (
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label className="text-xs font-semibold text-slate-600">
                    표지에 적힌 제목을 그대로 적어주세요
                  </label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void doApply();
                        }
                      }}
                      placeholder="예) 아씨방 일곱 동무"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:border-gia-gold"
                      autoComplete="off"
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={busy || newTitle.trim().length === 0}
                      onClick={() => void doApply()}
                      className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {busy ? "등록 중…" : "제목으로 등록 + 라벨 담기"}
                    </button>
                  </div>
                  {coverBlock}
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    ISBN 칸을 비워 두면 <b>도서관 라벨 번호(GIA-B-…)</b>를 새로 발급해 그 번호로 바코드를 만듭니다 — 붙이고
                    나면 그 책도 스캐너로 한 번에 찾힙니다. ISBN을 함께 적으면 그 번호가 라벨에 들어가고, 제목은 적으신
                    것을 씁니다(조회처 제목보다 표지가 맞습니다).
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── 등록되지 않은 ISBN: 이 책이 맞나요? ───────────────────────── */}
          {askRegister && found.kind === "new" && (
            <div className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-50/40 p-3">
              {found.preview ? (
                <>
                  <div className="flex gap-3">
                    {found.preview.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={found.preview.coverUrl}
                        alt=""
                        className="h-24 w-16 shrink-0 rounded object-cover shadow-sm"
                      />
                    ) : (
                      <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded bg-white text-2xl text-slate-300">
                        📘
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-emerald-700">이 책으로 등록합니다 — 맞습니까?</div>
                      <div className="mt-1 text-base font-bold text-slate-900">{found.preview.title}</div>
                      <div className="mt-0.5 text-sm text-slate-600">
                        {[found.preview.author, found.preview.publisher, found.preview.pubYear]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-slate-500">{found.code}</div>
                      {found.preview.source && (
                        <div className="mt-0.5 text-xs text-slate-500">{found.preview.source}에서 가져온 정보</div>
                      )}
                    </div>
                  </div>
                  {found.preview.choices.filter((c) => c.title.trim() !== found.preview?.title).length > 0 && (
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      다른 조회처는 「
                      {found.preview.choices
                        .filter((c) => c.title.trim() !== found.preview?.title)
                        .map((c) => c.title)
                        .join("」 · 「")}
                      」라고 답했습니다 — 등록한 뒤 한 번 눌러 바꿀 수 있습니다.
                    </p>
                  )}
                  {/*
                    ── 라벨을 뽑을지 ─────────────────────────────────────────
                    요청: "등록되지 않은 ISBN이라고 나오면 그냥 라벨 담기 하지 말고 등록할 수
                    있게 만들어줘. 굳이 라벨을 다시 뽑을 필요가 없어."

                    맞습니다. 찍어서 들어온 번호라면 그 책에는 쓸 수 있는 바코드가 이미
                    인쇄되어 있습니다 - 라벨은 같은 번호를 한 번 더 붙이는 일입니다. 그래서
                    기본은 **등록만**입니다. 손으로 쳐 넣은 번호(= 책에 바코드가 없다는 뜻)일
                    때만 라벨 쪽이 기본이 됩니다.
                  */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <span className="text-xs font-bold text-slate-500">라벨</span>
                    <button
                      type="button"
                      onClick={() => setWantLabel(false)}
                      className={`rounded-lg px-2.5 py-1.5 text-sm ${
                        !wantLabel ? "bg-gia-navy font-semibold text-white" : "border border-slate-300 text-slate-600"
                      }`}
                    >
                      필요 없습니다 (책 바코드 그대로)
                    </button>
                    <button
                      type="button"
                      onClick={() => setWantLabel(true)}
                      className={`rounded-lg px-2.5 py-1.5 text-sm ${
                        wantLabel ? "bg-gia-navy font-semibold text-white" : "border border-slate-300 text-slate-600"
                      }`}
                    >
                      라벨 뽑기 (모아뽑기에 담기)
                    </button>
                    <span className="text-xs text-slate-500">
                      {typedEntry
                        ? "번호를 손으로 치셨으니 책에 바코드가 없는 듯합니다 — 라벨이 있어야 찍힙니다"
                        : "찍어서 들어온 번호라 책에 바코드가 이미 있습니다 — 라벨은 같은 번호를 한 번 더 붙이는 일입니다"}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void doApply({ code: found.code, isbn: found.code })}
                      className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {busy ? "등록 중…" : wantLabel ? "맞습니다 — 등록 + 라벨 담기" : "맞습니다 — 등록만 하기"}
                    </button>
                    <button
                      type="button"
                      onClick={doSkip}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
                    >
                      아닙니다 — 넘기기
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-700">
                  조회처가 이 번호를 모릅니다. 아래에 <b>표지의 제목</b>을 적으면 그 제목으로 등록합니다.
                </p>
              )}

              {/* 제목을 직접 적어 등록하는 자리(조회가 안 되거나 제목이 다를 때). */}
              {found.preview && (
                <button
                  type="button"
                  onClick={() => {
                    setByTitle((v) => !v);
                    setNewTitle(found.preview?.title ?? "");
                  }}
                  className="mt-2 text-xs font-semibold text-gia-navy underline"
                >
                  {byTitle ? "제목 적기 접기" : "제목을 직접 적어 등록하기"}
                </button>
              )}
              {(byTitle || !found.preview) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void doApply({ code: found.code, isbn: found.code, title: newTitle.trim() });
                      }
                    }}
                    placeholder="표지에 적힌 제목을 그대로 적어주세요"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:border-gia-gold"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={busy || newTitle.trim().length === 0}
                    onClick={() => void doApply({ code: found.code, isbn: found.code, title: newTitle.trim() })}
                    className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {wantLabel ? "이 제목으로 등록 + 라벨 담기" : "이 제목으로 등록만 하기"}
                  </button>
                </div>
              )}
              {(byTitle || !found.preview) && coverBlock}
            </div>
          )}

          {/* ── 이미 등록된 책: 같은 책인가, 또 한 권인가 ──────────────────── */}
          {found.kind === "isbn" && (
            <div className="mt-3 rounded-xl border-2 border-gia-gold/50 bg-amber-50/40 p-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span>
                  장서에 적힌 보유 <b className="text-gia-navy">{found.counts.copies}권</b>
                </span>
                <span>
                  책장등록에서 찍힌 <b className="text-emerald-700">{found.counts.shelf}권</b>
                  {found.counts.rows > 0 && (
                    <span className="text-xs text-slate-500"> ({found.counts.rows}칸)</span>
                  )}
                </span>
                {found.counts.loansOut > 0 && (
                  <span className="text-xs text-slate-500">대출 중 {found.counts.loansOut}권</span>
                )}
              </div>

              {/*
                ── 묻는 것은 「이 한 권이 장서에 이미 세어져 있나」입니다 ──────
                처음에는 「책장등록 때 이미 센 책이냐」고 물었습니다. 그런데 책장등록 0권 ·
                장서 1권인 책이 바로 걸렸습니다 - 그 한 권은 책장등록을 안 한 것뿐이고, 손에
                든 이 책이 **바로 그 한 권**입니다. 그런데 화면에는 「장서를 2권으로」와
                「책장등록 때 이미 센 책」 두 가지뿐이라 둘 다 틀린 말이었습니다.

                장서 권수를 올릴지 말지가 문제이므로, 묻는 말도 그것이어야 합니다.

                  아직 안 세어진 권수 = 장서 - 책장등록 - 대출중

                이 수가 남아 있으면 손에 든 책은 그중 하나입니다(숫자 그대로). 0이면 장서에
                없던 한 권입니다(+1). 숫자를 보고 추천은 하되, 정하는 것은 사람입니다.
              */}
              {/*
                ── 이 줄에 붙어 있는 번호를 그대로 보여줍니다 ────────────────
                책에 0448427052 라고 적혀 있는데 화면에 9780448427058 이 뜨면 「다른 번호
                아니냐」가 됩니다. 같은 번호의 10자리·13자리 모습입니다. 그리고 이 줄이
                상품코드를 아직 달고 있는지는 지금까지 화면에 전혀 나오지 않았습니다 - 번호
                판정이 item_code 한 칸만 보기 때문에, 상품코드가 옮겨진 뒤에는 「이미 등록된
                책」으로만 보였습니다.
              */}
              <div className="mt-2 space-y-1 rounded-lg bg-white px-3 py-2 text-xs leading-relaxed">
                <p className="text-slate-700">
                  <span className="font-bold text-slate-500">이 책의 번호 </span>
                  ISBN <b className="text-sm text-gia-navy">{found.codes.isbn ?? "없음"}</b>
                  {found.codes.sameIsbn && found.codes.scanned !== found.codes.isbn && (
                    <span className="text-slate-500">
                      {" "}
                      — 찍은 <b>{found.codes.scanned}</b> 과 <b>같은 번호</b>입니다(ISBN 10자리 ↔ 13자리: 앞에
                      978 을 붙이고 맨 끝 검사 숫자를 다시 계산합니다)
                    </span>
                  )}
                </p>
                {found.codes.itemCode && (
                  <p className="text-slate-700">
                    <span className="font-bold text-slate-500">도서관 라벨 </span>
                    <b className="text-sm text-gia-navy">{found.codes.itemCode}</b>
                    <span className="text-slate-500"> — 이미 발급되어 있습니다</span>
                  </p>
                )}
                {found.codes.productCode ? (
                  <div className="rounded-md bg-amber-50 px-2 py-1.5">
                    <p className="text-amber-900">
                      <span className="font-bold">상품코드 </span>
                      <b className="text-sm">{found.codes.productCode}</b> 가 아직 이 줄에 남아 있습니다 —{" "}
                      <b>일부러 남겨 둔 것</b>입니다. 책에는 아직 상품코드 바코드가 붙어 있으니 그 번호를 찍어도
                      이 줄이 걸려야 합니다. <b>라벨을 책에 붙인 뒤</b>에 떼면 번호가 하나로 정리됩니다.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void dropProduct(found.book)}
                      className="mt-1.5 rounded-lg border border-amber-500 bg-white px-2.5 py-1.5 text-xs font-bold text-amber-900 disabled:opacity-50"
                    >
                      🏷 라벨 붙였습니다 — 상품코드 떼기
                    </button>
                  </div>
                ) : (
                  <p className="text-slate-500">
                    상품코드는 남아 있지 않습니다 — 이 줄은 번호가 하나로 정리되어 있습니다.
                  </p>
                )}
              </div>

              {/* ── 라벨을 뽑을까, 책에 있는 바코드를 그대로 쓸까 ───────────── */}
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <span className="text-xs font-bold text-slate-500">라벨</span>
                <button
                  type="button"
                  onClick={() => setWantLabel(false)}
                  className={`rounded-lg px-2.5 py-1.5 text-sm ${
                    !wantLabel ? "bg-gia-navy font-semibold text-white" : "border border-slate-300 text-slate-600"
                  }`}
                >
                  필요 없습니다 (책 바코드 그대로)
                </button>
                <button
                  type="button"
                  onClick={() => setWantLabel(true)}
                  className={`rounded-lg px-2.5 py-1.5 text-sm ${
                    wantLabel ? "bg-gia-navy font-semibold text-white" : "border border-slate-300 text-slate-600"
                  }`}
                >
                  라벨 뽑기 (모아뽑기에 담기)
                </button>
                <span className="text-xs text-slate-500">
                  {wantLabel ? (
                    <>
                      라벨에 찍히는 번호는 <b className="text-gia-navy">{found.codes.labelPrints ?? "없음"}</b>{" "}
                      입니다
                      {found.codes.itemCode
                        ? " (도서관 라벨 번호). 뽑아서 붙이는 일이고, 기록은 바뀌지 않습니다 — ISBN 은 이미 적혀 있습니다."
                        : " (ISBN). 뽑아서 붙이는 일이고, 기록은 바뀌지 않습니다."}
                    </>
                  ) : (
                    "찍은 그 바코드가 이 책의 번호입니다 — 라벨은 같은 번호를 한 번 더 붙이는 일입니다"
                  )}
                </span>
              </div>

              {(() => {
                const notCounted = found.counts.copies - found.counts.shelf - found.counts.loansOut;
                /*
                  ── 늘릴 때와 늘리지 않을 때 ─────────────────────────────────
                  장서 1권 · 책장등록 1권이면 그 한 권은 책장에서 세어졌습니다. 그러니 손에 든
                  이 책은 **그 위에 더 있는 한 권**이고, 그때만 +1 이 맞습니다.

                  장서 1권 · 책장등록 0권이면 다릅니다. 그 한 권은 책장등록을 안 한 것뿐이고
                  손에 든 이 책이 바로 그 한 권입니다. 여기서 +1 을 하면 없는 책이 한 권
                  생깁니다. 그래서 그때는 **늘리지 않고**, 책장에 꽂은 뒤 「자리 등록」에서
                  찍어 달라고 말하고 넘깁니다 - 그래야 책장과 장서가 맞아떨어집니다.
                */
                const addIsRight = notCounted <= 0;
                const where = found.place.checks.map((c) => `${c.code} ${c.copies}권`).join(" · ");
                return addIsRight ? (
                  <>
                    {/*
                      ── 늘리기 전에 **가서 볼 자리**를 알려줍니다 ────────────────
                      요청: "장서 보유 1권에 책장등록 1권이면 책장 위치를 알려줘야 해."

                      맞습니다. 「그 한 권은 책장에서 세어졌으니 손에 든 건 또 한 권」이라는 말은
                      **그 한 권이 지금도 거기 있을 때만** 맞습니다. 누가 빼 왔을 수도, 이미
                      손에 든 이 책이 그 책일 수도 있습니다. 확인할 수 있는 유일한 방법은 그 칸에
                      가 보는 것이고, 그러려면 칸 번호가 눈앞에 있어야 합니다.
                    */}
                    <div className="mt-2 rounded-lg border border-gia-navy/30 bg-white px-3 py-2.5">
                      <p className="text-sm leading-relaxed text-slate-700">
                        장서 {found.counts.copies}권이 책장에서 모두 찍혔습니다 — 손에 든 이 책은 그 위에 더 있는 한
                        권으로 보입니다.
                      </p>
                      {where ? (
                        <p className="mt-1 text-sm text-slate-700">
                          책장에서 찍힌 그 {found.counts.shelf}권은{" "}
                          <b className="text-base text-gia-navy">{where}</b> 에 있습니다 —{" "}
                          <b>가서 같은 책이 꽂혀 있는지 보고</b> 눌러주세요. 거기 있으면 손에 든 이 책은 또 한 권이
                          맞습니다.
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">
                          찍힌 칸이 기록되어 있지 않습니다 — 칸을 확인할 수 없으니 「넘기기」로 두고 나중에 보시는
                          편이 안전합니다.
                        </p>
                      )}
                    </div>
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void doAddCopy(found.book)}
                        className="rounded-lg border-2 border-gia-navy bg-white px-3 py-2.5 text-left text-sm font-semibold text-gia-navy disabled:opacity-50"
                      >
                        장서에 <b>없던 한 권</b>입니다
                        <div className="mt-0.5 text-xs font-normal text-slate-600">
                          장서를 {found.counts.copies}권 → <b>{found.counts.copies + 1}권</b>으로{" "}
                          {wantLabel ? "하고 라벨 담기" : "하기 (라벨 없음)"}
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void doLabelOnly(found.book)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-sm font-semibold text-slate-700 disabled:opacity-50"
                      >
                        아니요 — <b>장서에 이미 있는 그 책</b>입니다
                        <div className="mt-0.5 text-xs font-normal text-slate-600">
                          장서 {found.counts.copies}권 그대로 두고{" "}
                          {wantLabel ? "라벨만 담기" : "넘어가기 (라벨 없음)"}
                        </div>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-2 rounded-lg bg-white px-3 py-2.5">
                      <p className="text-sm leading-relaxed text-slate-700">
                        장서에는 {found.counts.copies}권인데 책장에서는 {found.counts.shelf}권만 찍혔습니다 —{" "}
                        <b>{notCounted}권이 아직 책장 밖</b>에 있다는 뜻이고, 손에 든 이 책이 그 한 권입니다.
                        <b> 장서 숫자는 그대로 둡니다</b>(여기서 늘리면 없는 책이 한 권 생깁니다).
                      </p>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                        넘기면 <b>책장 미등록 장서</b>에 적어 둡니다. 라벨을 붙여 책장에 꽂은 뒤{" "}
                        <Link href="/offshelf" className="font-semibold text-gia-navy underline">
                          그 화면
                        </Link>
                        이나{" "}
                        <Link href="/place" className="font-semibold text-gia-navy underline">
                          자리 등록
                        </Link>
                        에서 칸을 찍어 주세요 — 그때 비로소 책장 숫자와 장서가 맞아떨어집니다.
                      </p>
                    </div>
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void doLabelOnly(found.book, true)}
                        className="rounded-lg border-2 border-gia-navy bg-white px-3 py-2.5 text-left text-sm font-semibold text-gia-navy disabled:opacity-50"
                      >
                        {wantLabel ? "라벨 담고 넘기기" : "그대로 넘기기"}
                        <div className="mt-0.5 text-xs font-normal text-slate-600">
                          장서 {found.counts.copies}권 그대로 — <b>책장 미등록 장서</b>에 적어 둡니다
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void doAddCopy(found.book)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-xs text-slate-600 disabled:opacity-50"
                      >
                        아니요 — 이것 말고 <b>또 한 권</b>이 더 있습니다
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          장서를 {found.counts.copies}권 → {found.counts.copies + 1}권으로
                        </div>
                      </button>
                    </div>
                  </>
                );
              })()}

              <button
                type="button"
                onClick={doSkip}
                className="mt-2 w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600"
              >
                아직 모르겠습니다 — <b>넘기기</b> (자리에 가서 확인하고 다시 찍으면 됩니다)
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 무엇이 무엇으로 바뀌었나 ───────────────────────────────────── */}
      {result?.after && (
        <section className="mt-5 rounded-2xl border-2 border-emerald-300 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">바꿨습니다</span>
            <span className="text-sm font-semibold text-slate-800">{result.message}</span>
            <span className="ml-auto text-xs text-slate-500">
              찍은 번호 <span className="font-mono">{result.scanned}</span>
              {result.what ? ` · ${WHAT_KO[result.what] ?? result.what}` : ""}
              {result.foundBy ? ` · 책 정보 ${result.foundBy}` : ""}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
            {/* 전 */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-500">바꾸기 전</div>
              {result.before ? (
                <dl className="mt-2">
                  <Row k="제목" v={result.before.title} strong />
                  <Row k="번호" v={<span className="font-mono">{result.before.code ?? result.before.isbn ?? "—"}</span>} />
                  <Row k="권수" v={`${result.before.copies}권`} />
                  <Row k="등급" v={result.before.level != null ? `${result.before.level}등급` : "없음"} />

                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  등록되어 있지 않던 번호입니다 — 바꾼 것이 아니라 <b>새로 등록</b>했습니다.
                </p>
              )}
            </div>

            {/* → */}
            <div className="flex items-center justify-center text-2xl text-emerald-500 sm:px-1">
              <span className="hidden sm:inline">→</span>
              <span className="sm:hidden">↓</span>
            </div>

            {/* 후 */}
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/50 p-3">
              <div className="text-xs font-bold text-emerald-700">바꾼 뒤</div>
              <div className="mt-2 flex gap-3">
                {result.after.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.after.coverUrl} alt="" className="h-20 w-14 shrink-0 rounded object-cover shadow-sm" />
                ) : (
                  <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded bg-white text-xl text-slate-300">
                    📘
                  </div>
                )}
                <dl className="min-w-0 flex-1">
                  <Row
                    k="제목"
                    v={result.after.title}
                    strong
                    changed={!result.before || result.before.title !== result.after.title}
                  />
                  <Row
                    k="번호"
                    v={<span className="font-mono">{result.after.code ?? result.after.isbn ?? "—"}</span>}
                    changed={(result.before?.code ?? null) !== (result.after.code ?? null)}
                  />
                  <Row
                    k="권수"
                    v={`${result.after.copies}권`}
                    changed={(result.before?.copies ?? -1) !== result.after.copies}
                  />
                  <Row
                    k="등급"
                    v={result.after.level != null ? `${result.after.level}등급` : "없음"}
                    changed={(result.before?.level ?? null) !== (result.after.level ?? null)}
                  />

                  {(result.after.author || result.after.publisher) && (
                    <Row
                      k="지은이"
                      v={[result.after.author, result.after.publisher].filter(Boolean).join(" · ")}
                    />
                  )}
                </dl>
              </div>
            </div>
          </div>

          {/* ── 제목이 손에 든 책과 다를 때 ──────────────────────────────── */}
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xs font-bold text-slate-500">제목</span>
              <span className="text-sm font-semibold text-slate-800">{result.after.title}</span>
              {result.titleFrom && (
                <span className="text-xs text-slate-500">— {result.titleFrom}에서 가져온 제목입니다</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setTitleEditing((v) => !v);
                  setTitleDraft(result.after?.title ?? "");
                }}
                className="ml-auto text-xs font-semibold text-gia-navy underline"
              >
                {titleEditing ? "접기" : "제목이 책과 다릅니다"}
              </button>
            </div>

            {/*
              조회처에서 못 찾은 경우. 이때 남아 있는 제목은 **상자 제목**이라, 전집이면 거의
              틀립니다. 그냥 두면 모르고 지나가므로 눈에 띄게 말합니다.
            */}
            {result.titleKept && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                조회처에서 이 ISBN을 찾지 못해 <b>원래 줄의 제목을 그대로</b> 두었습니다. 상품코드 한 줄에 여러 권이
                묶여 있던 제목이라 이 책의 제목이 아닐 수 있습니다 — 표지를 보고 적어주세요.
              </p>
            )}

            {/* 다른 조회처가 답한 제목들 */}
            {result.titleChoices.filter((c) => c.title.trim() !== result.after?.title).length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-slate-500">다른 조회처는 이렇게 답했습니다 — 맞는 것을 누르세요</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {result.titleChoices
                    .filter((c) => c.title.trim() !== result.after?.title)
                    .map((c) => (
                      <button
                        key={`${c.source}-${c.title}`}
                        type="button"
                        disabled={busy}
                        onClick={() => void doSetTitle(c.title.trim(), c)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-left text-sm text-slate-700 hover:border-gia-gold disabled:opacity-50"
                        title="이 제목으로 바꿉니다(저자·출판사·표지도 함께)"
                      >
                        <span className="mr-1 text-xs text-slate-400">{c.source}</span>
                        {c.title}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {(titleEditing || result.titleKept) && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void doSetTitle(titleDraft);
                    }
                  }}
                  placeholder="표지에 적힌 제목을 그대로 적어주세요"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-gia-gold"
                  autoComplete="off"
                />
                <button
                  type="button"
                  disabled={busy || !titleDraft.trim()}
                  onClick={() => void doSetTitle(titleDraft)}
                  className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  제목 고치기
                </button>
              </div>
            )}
          </div>

          {/* 남은 권수 */}
          {result.leftover && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              남은 권수는 상품코드 <span className="font-mono">{result.leftover.code}</span> 줄에{" "}
              <b>{result.leftover.copies}권</b> 그대로 있습니다 — 같은 번호를 또 찍으면 또 한 권이 떨어져 나옵니다.
            </p>
          )}

          {/* 라벨에 찍힐 번호 — 눈으로 대보는 자리 */}
          {result.barcode && (
            <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div>
                <div className="text-xs font-bold text-slate-500">라벨에 찍힐 번호</div>
                <div className="mt-0.5 font-mono text-sm text-slate-800">{result.barcode}</div>
                <p className="mt-1 text-xs text-slate-500">표지의 ISBN 숫자와 대보세요.</p>
              </div>
              <Barcode value={result.barcode} moduleWidth={1.2} height={46} className="ml-auto block" />
            </div>
          )}

          {/* 되돌리기 · 수정 */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              disabled={busy || !result.logId}
              onClick={() => void doUndo(result.logId ?? "", result.after?.id)}
              className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
              title="바꾸기 전으로 돌리고 라벨도 뺍니다"
            >
              ↺ 되돌리기
            </button>
            <button
              type="button"
              disabled={busy || !result.logId}
              onClick={() => {
                setEditing((v) => !v);
                setEditIsbn(result.after?.isbn ?? "");
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
              title="되돌린 뒤 다른 ISBN으로 다시 등록합니다"
            >
              ✎ 수정 (ISBN 다시)
            </button>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setEditing(false);
                scanRef.current?.focus();
              }}
              className="ml-auto rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white"
            >
              다음 책 찍기
            </button>
          </div>

          {editing && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="text-xs font-semibold text-slate-600">
                이 책의 ISBN을 다시 적어주세요 — 되돌린 뒤 이 번호로 다시 등록합니다
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  value={editIsbn}
                  onChange={(e) => setEditIsbn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void doRedo();
                    }
                  }}
                  placeholder="978… 또는 10자리(끝이 X여도 됩니다)"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base tracking-wider outline-none focus:border-gia-gold"
                  autoComplete="off"
                  autoFocus
                />
                <button
                  type="button"
                  disabled={busy || ![10, 13].includes(normalizeIsbn(editIsbn).length)}
                  onClick={() => void doRedo()}
                  className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "다시 등록 중…" : "이 ISBN으로 다시"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
                >
                  그만
                </button>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                되돌리기와 다시 등록을 <b>한 번에</b> 합니다. 되돌릴 수 없는 경우(그 뒤에 같은 상품코드를 또 재등록한
                경우)에는 아무것도 바꾸지 않고 그 이유를 말합니다. 잘못 담긴 라벨은 모아뽑기에서 함께 빼 드립니다.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── 모아뽑기 ────────────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-gia-gold/40 bg-amber-50/50 px-4 py-3">
        <div className="text-sm text-slate-700">
          모아뽑기에 <b>{pile?.count ?? 0}장</b> 담겨 있습니다
          {(pile?.count ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setShowPile((v) => !v)}
              className="ml-2 text-xs font-semibold text-gia-navy underline"
            >
              {showPile ? "목록 접기" : "목록 보고 빼기"}
            </button>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          {pile && pile.count > 0 && (
            <>
              <Link
                href={`/print/labels?job=${pile.id}`}
                target="_blank"
                className="rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white"
              >
                라벨 뽑기 ({pile.count}장)
              </Link>
              <Link
                href={`/print/labels?job=${pile.id}&per=2`}
                target="_blank"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                title="한 줄에 2장 — 막대가 0.63mm로 굵어집니다"
              >
                크게 뽑기
              </Link>
              {/* 뽑고 나면 여기서 넘깁니다 - 안 넘기면 다음 종이에 이미 붙인 라벨이 함께 나옵니다. */}
              <button
                type="button"
                disabled={busy}
                onClick={() => void doneWithPile()}
                className="rounded-lg border-2 border-emerald-500 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-50"
                title="모아뽑기를 비우고 뽑은 기록으로 남깁니다 — 기록에서 다시 뽑을 수 있습니다"
              >
                ✓ 뽑았습니다 — 기록으로 넘기기
              </button>
            </>
          )}
          <Link href="/print-jobs" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600">
            모아뽑기 관리
          </Link>
          {/* 들고 다닐 종이 — 책장 밖에 남은 책이 무엇인지. */}
          <Link
            href="/print/offshelf"
            target="_blank"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
            title="책장등록에 안 나온 책 목록을 종이로 뽑습니다"
          >
            🖨 남은 책 목록
          </Link>
        </div>

        {/*
          ── 담긴 목록 ────────────────────────────────────────────────────
          숫자만 보고는 무엇이 잘못 담겼는지 알 수 없어서, 한 장을 빼려면 전부 비우고 처음부터
          다시 담아야 했습니다. 담긴 차례대로 보여주고 한 장씩 뺍니다 - 방금 잘못 담은 것이
          맨 아래에 있습니다.
        */}
        {showPile && pileBooks.length > 0 && (
          <div className="w-full">
            <div className="mt-1 max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white">
              <div className="divide-y divide-slate-100 text-sm">
                {pileBooks.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="font-semibold text-slate-800">{b.title}</span>
                    {b.code && <span className="font-mono text-xs text-slate-500">{b.code}</span>}
                    {b.count > 1 && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                        {b.count}장
                      </span>
                    )}
                    <span className="ml-auto flex gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeFromPile(b.id)}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 disabled:opacity-50"
                      >
                        한 장 빼기
                      </button>
                      {b.count > 1 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void removeFromPile(b.id, true, b.count)}
                          className="rounded border border-rose-200 px-2 py-0.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
                        >
                          {b.count}장 전부
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              잘못 담긴 것만 빼면 됩니다 — 전부 비우지 않아도 됩니다. 복본은 권수만큼 여러 장이 들어 있는 것이
              정상입니다.
            </p>
          </div>
        )}
      </div>

      {/* ── 뽑은 기록 ───────────────────────────────────────────────────── */}
      {printed.length > 0 && (
        <section className="mt-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-bold text-gia-navy">뽑은 기록 {printed.length}묶음</h2>
            <button
              type="button"
              onClick={() => setShowPrinted((v) => !v)}
              className="text-xs font-semibold text-gia-navy underline"
            >
              {showPrinted ? "접기" : "펼쳐 보기"}
            </button>
            <span className="ml-auto text-xs text-slate-500">
              프린터가 씹었으면 여기서 다시 뽑거나 모아뽑기에 되담으세요
            </span>
          </div>
          {showPrinted && (
            <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
              {printed.map((j) => (
                <div key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="font-semibold text-slate-800">{j.title}</span>
                  <span className="text-xs text-slate-500">{j.count}장</span>
                  <span className="ml-auto flex gap-1.5">
                    <Link
                      href={`/print/labels?job=${j.id}`}
                      target="_blank"
                      className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700"
                    >
                      다시 뽑기
                    </Link>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void rePile(j.id)}
                      className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                      title="이 묶음을 모아뽑기에 다시 담습니다"
                    >
                      모아뽑기에 되담기
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── 지금까지 재등록한 것 ───────────────────────────────────────── */}
      {recent.length > 0 && (
        <section className="mt-6">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-bold text-gia-navy">재등록한 기록 {liveRecent.length}건</h2>
            <button
              type="button"
              onClick={() => setShowRecent((v) => !v)}
              className="text-xs font-semibold text-gia-navy underline"
            >
              {showRecent ? "접기" : "펼쳐 보기"}
            </button>
            <span className="ml-auto text-xs text-slate-500">
              새로고침해도 남습니다 — 창을 닫았다 와도 되돌릴 수 있습니다
            </span>
          </div>
          {showRecent && (
            <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="divide-y divide-slate-100 text-sm">
                {recent.map((r) => (
                  <div
                    key={r.id}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${
                      r.undoneAt ? "bg-slate-50 text-slate-400" : ""
                    }`}
                  >
                    <span className="font-mono text-xs text-slate-500">{r.code}</span>
                    <span className="text-slate-400">→</span>
                    <span className="font-mono text-xs text-emerald-700">{r.isbn ?? "—"}</span>
                    {/*
                      제목은 **책에서** 읽어온 것입니다(afterTitle). 바꾸기 전 제목이 따로 남아
                      있고 서로 다를 때만 「전 제목 → 후 제목」으로 보여줍니다 - 상품코드 줄의
                      제목이 전집 이름이었다가 그 권의 제목으로 바뀌는 일이 흔합니다.
                    */}
                    <span className={`font-semibold ${r.undoneAt ? "line-through" : "text-slate-800"}`}>
                      {r.beforeTitle && r.afterTitle && r.beforeTitle !== r.afterTitle ? (
                        <>
                          <span className="font-normal text-slate-500">{r.beforeTitle}</span>
                          <span className="mx-1 text-slate-400">→</span>
                          {r.afterTitle}
                        </>
                      ) : (
                        (r.afterTitle ?? r.beforeTitle ?? "(그 줄이 지워졌습니다)")
                      )}
                    </span>
                    <span className="text-xs text-slate-400">{WHAT_KO[r.what] ?? r.what}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      {new Date(r.at).toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {r.undoneAt ? (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                        되돌림
                      </span>
                    ) : r.canUndo ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void doUndo(r.id)}
                        className="rounded border border-rose-200 px-2 py-0.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
                      >
                        ↺ 되돌리기
                      </button>
                    ) : (
                      <span
                        className="text-xs text-slate-400"
                        title="되돌리기가 생기기 전에 한 재등록입니다 — 바꾸기 전 모습이 남아 있지 않습니다"
                      >
                        되돌릴 수 없음
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            되돌리기는 <b>나중에 한 것부터</b>입니다. 같은 상품코드에서 한 권을 뗀 뒤 또 한 권을 떼었다면, 첫 번째를
            되돌리는 것은 두 번째를 지우는 일이 되므로 거절합니다 — 조용히 어긋나게 만드는 것보다 낫습니다.
          </p>
        </section>
      )}

      <p className="mt-8 text-xs leading-relaxed text-slate-500">
        라벨에는 그 책의 ISBN이 바코드로 들어갑니다. 붙인 뒤에는 그 라벨을 찍으면 바로 그 책이 나옵니다 — 상품코드처럼 열두 권이
        한꺼번에 걸리지 않습니다. 찍었던 상품코드도 함께 적어 두므로, 라벨을 붙이기 전에 그 책을 또 찍어도 같은 책으로 찾힙니다.
      </p>
    </div>
  );
}

/**
 * 전/후 칸 한 줄. 달라진 칸은 색으로 표시합니다 - 다섯 줄을 눈으로 비교하게 두면 사람은
 * 틀린 곳을 놓칩니다.
 */
function Row({
  k,
  v,
  strong,
  changed,
}: {
  k: string;
  v: React.ReactNode;
  strong?: boolean;
  changed?: boolean;
}) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <dt className="w-12 shrink-0 pt-0.5 text-xs text-slate-500">{k}</dt>
      <dd className={`min-w-0 break-words ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>
        {changed ? (
          <span className="rounded bg-emerald-100 px-1 text-emerald-900">{v}</span>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}
