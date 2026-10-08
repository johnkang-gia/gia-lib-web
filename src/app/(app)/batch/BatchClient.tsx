"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanner from "@/components/BarcodeScanner";
import CoverShot from "@/components/CoverShot";
import CoverCrop from "@/components/CoverCrop";
import { createClient } from "@/lib/supabase/client";
import { formatIsbn, isBookBarcode, normalizeScan } from "@/lib/scan";
import type { BookLookup, LibBook, LibLocation } from "@/lib/types";
import type { CoverRead } from "@/lib/ai/readCover";
import { FULL, pad } from "@/lib/coverBox";
import { cropImage } from "@/lib/cropImage";
import { useScanFocus } from "@/lib/useScanFocus";
import HealthBanner from "@/components/HealthBanner";

type Status = "찾는중" | "준비" | "제목필요" | "ISBN필요" | "복본" | "실패";

type Item = {
  key: string;
  /** 실제로 찍힌 값(ISBN이 아닐 수도 있습니다). */
  code: string;
  isbn: string;
  /** 찍힌 값이 ISBN이 아니면(UPC 등) 함께 저장할 값. */
  scanCode: string | null;
  title: string;
  author: string;
  publisher: string;
  pub_year: string;
  cover_url: string;
  language: "한국어" | "영어" | "기타";
  category: string;
  audience: string;
  series: string;
  seriesNo: string;
  /** 이 책에 붙어 있는 라벨 일련번호(자동으로 하나씩 올라갑니다). */
  labelNo: string;
  /** 같은 책을 몇 권 담았는지. 중복 스캔을 '여러 권'이라고 답하면 늘어납니다. */
  copies: number;
  status: Status;
  note: string;
  /** 이미 등록된 책이면 그 id - 등록 대신 구역만 바꿉니다. */
  existingId: string | null;
  /**
   * 직접 찍은 표지 사진(배경을 잘라낸 것). 등록할 때 저장소에 올리고 그 주소를 표지로 씁니다.
   * 출판사 표지가 있어도 이쪽이 있으면 이쪽을 씁니다 - 사람이 "이 사진을 표지로" 를 고른
   * 경우에만 담기기 때문입니다.
   */
  coverBlob: Blob | null;
  /** 목록에 보여줄 작은 미리보기(올리기 전이라 아직 주소가 없습니다). */
  coverPreview: string;
};

/**
 * 여러 권을 한꺼번에 등록하는 화면.
 *
 * 요청: "책을 연속으로 등록할 수 있게 해줘 바코드로 쭉 찍고 등록하도록... a구역 책들을 한꺼번에
 * 바코드 등록해서 a구역으로 한꺼번에 등록할 수 있게".
 *
 * 구역을 먼저 고르고 바코드를 주르륵 찍으면 목록에 쌓입니다. 책 정보는 찍는 즉시 인터넷에서
 * 자동으로 채워지고, 마지막에 한 번만 누르면 전부 그 구역으로 등록됩니다.
 * USB 스캐너(도서관 노트북)와 휴대폰 카메라 둘 다 됩니다.
 */
export default function BatchClient({ locations }: { locations: LibLocation[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [locationId, setLocationId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [value, setValue] = useState("");
  /** 바코드 없는 책을 담을 때 적는 제목. */
  const [manualTitle, setManualTitle] = useState("");
  /**
   * 표지 촬영 - 바코드 없는 책의 제목을 손으로 치지 않고 사진으로 받습니다.
   *
   * 요청: "바코드 없는 책은 휴대폰으로 책 표지 찍으면 자동으로 책 제목 넣어줄 수 있어?
   * 아니면 노트북 내의 카메라로 찍어서 등록할 수 있게".
   */
  const [shotOpen, setShotOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [cover, setCover] = useState<{
    /** 방금 찍은 사진 - 후보와 나란히 보여 주어 손에 든 책과 맞는지 보게 합니다. */
    shot: string;
    read: CoverRead;
    candidates: BookLookup[];
    message?: string;
    /** 배경을 잘라낸 표지. 찍는 즉시 자동으로 만들어 둡니다. */
    cropped: { blob: Blob; preview: string } | null;
    /** 이 사진을 그 책의 표지로 쓸지. 출판사 표지가 있는 후보가 있으면 기본으로 끕니다. */
    usePhoto: boolean;
  } | null>(null);
  /** 자동으로 잡은 표지 범위를 손으로 고치는 중인지. */
  const [editCrop, setEditCrop] = useState(false);
  /**
   * 화면에서 고칠 수 있는 제목.
   *
   * 표지의 꾸민 글씨(손글씨체·그림 속 글자)는 한 글자가 틀리게 읽히는 일이 있습니다. 그런데
   * 제목 검색은 한 글자만 달라도 0건이 되어, 사람 눈에는 제목이 멀쩡히 보이는데 후보가
   * 하나도 없는 상황이 됩니다. 사진을 다시 찍게 하는 건 답이 아닙니다(다시 찍어도 같은
   * 글씨입니다). 그래서 글자를 고쳐 다시 찾게 합니다.
   */
  const [coverTitle, setCoverTitle] = useState("");
  const [coverError, setCoverError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  // 이번에 담는 책들이 모두 "바코드가 인쇄되어 있지 않은 책"인 경우(라벨을 뽑아 붙일 예정).
  const [needLabel, setNeedLabel] = useState(false);
  // 지금 책에 붙어 있는 색 라벨. 한 칸을 통째로 등록하는 동안에는 등급이 같으므로 위에서 한 번만
  // 고르고, 일련번호는 찍을 때마다 하나씩 올라갑니다(요청: 번호를 넣는 게 나을지 고민).
  const [labelLevel, setLabelLevel] = useState<string>("");
  const [labelNext, setLabelNext] = useState<string>("");
  const labelNextRef = useRef<string>("");
  labelNextRef.current = labelNext;
  const [saving, setSaving] = useState(false);
  /**
   * 같은 바코드를 또 찍었을 때 물어보는 창.
   *
   * 요청: "중복되는 책이 바코드로 찍히면 잘못해서 두번찍은건지, 아니면 같은책이 여러권있는건지
   * 물어보고, 여러권이라고하면 찍으면 바로 권수 추가해줘".
   *
   * 스캐너가 한 번 찍었는데 두 번 읽히는 일도 흔하고, 실제로 같은 책이 두 권인 경우도 흔합니다.
   * 둘을 앱이 알아맞힐 수는 없으므로 사람에게 묻습니다. 답하기 전에도 다른 책은 계속 찍을 수
   * 있도록 화면을 막지 않습니다.
   */
  const [dupAsk, setDupAsk] = useState<{ code: string; title: string; times: number } | null>(null);
  /**
   * 지금 담겨 있는 바코드 목록.
   *
   * 화면 상태(items)로 중복을 판정하면 놓칩니다 - React는 상태 갱신 함수를 나중에 실행하므로,
   * 바로 다음 줄에서 "이미 담겼나?"를 읽으면 아직 옛 값입니다. 스캐너가 한 번 찍었는데 두 번
   * 읽히는 경우처럼 몇 밀리초 사이에 두 번 들어오면 이 차이가 그대로 버그가 됩니다.
   * 그래서 판정용 목록은 즉시 반영되는 ref로 따로 들고 있습니다.
   */
  const codesRef = useRef<Set<string>>(new Set());
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const [done, setDone] = useState<{ added: number; moved: number; failed: number; ids: string[] } | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // USB 스캐너용 - 카메라를 안 쓰는 동안에는 입력칸에 커서를 붙들어 둡니다.
  // 사람이 드롭다운·입력칸을 쓰는 중이면 비켜줍니다(useScanFocus 안에 규칙이 있습니다).
  const refocus = useScanFocus(inputRef, !camera && !shotOpen);

  /**
   * 다음 라벨 번호를 하나 꺼내고, 칸을 하나 올려둡니다.
   * '007' 처럼 앞자리 0이 있으면 자릿수를 지켜서 '008'로 올립니다.
   */
  const nextLabelNo = useCallback(() => {
    const cur = labelNextRef.current.trim();
    if (!cur) return "";
    const digits = cur.replace(/[^0-9]/g, "");
    if (!digits) return cur;
    const width = digits.length;
    const next = String(Number(digits) + 1).padStart(width, "0");
    labelNextRef.current = next;
    setLabelNext(next);
    return cur;
  }, []);

  /** 찍힌 값 하나를 목록에 추가하고, 뒤이어 책 정보를 채웁니다. */
  const add = useCallback(
    async (raw: string, shotCover?: { blob: Blob; preview: string }) => {
      const code = normalizeScan(raw);
      if (!code) return;

      // 이미 담긴 책을 또 찍었습니다 - 두 번 찍은 건지 여러 권인지 물어봅니다.
      if (codesRef.current.has(code)) {
        const same = itemsRef.current.find((it) => it.code === code);
        const title = same?.title || code;
        setDupAsk((prev) =>
          prev && prev.code === code
            ? { ...prev, times: prev.times + 1, title }
            : { code, title, times: 1 }
        );
        return;
      }
      codesRef.current.add(code);

      setItems((prev) => {
        return [
          {
            key: `${code}-${Date.now()}`,
            code,
            isbn: "",
            scanCode: null,
            title: "",
            author: "",
            publisher: "",
            pub_year: "",
            cover_url: "",
            language: "한국어",
            category: "",
            audience: "",
            series: "",
            seriesNo: "",
            labelNo: nextLabelNo(),
            copies: 1,
            status: "찾는중",
            note: "",
            existingId: null,
            coverBlob: shotCover?.blob ?? null,
            coverPreview: shotCover?.preview ?? "",
          },
          ...prev,
        ];
      });

      const patch = (changes: Partial<Item>) =>
        setItems((prev) => prev.map((it) => (it.code === code ? { ...it, ...changes } : it)));

      try {
        const res = await fetch(`/api/books/lookup?code=${encodeURIComponent(code)}`);
        if (res.status === 401) {
          patch({
            status: "실패",
            note: "로그인이 풀렸습니다 — 새로고침(Ctrl+Shift+R) 후 다시 로그인해 주세요",
          });
          return;
        }
        const json = (await res.json()) as {
          existing?: LibBook | null;
          found?: BookLookup | null;
          canonicalIsbn?: string;
          upc?: string;
          message?: string;
          error?: string;
        };

        if (json.existing) {
          patch({
            status: "복본",
            title: json.existing.title,
            author: json.existing.author ?? "",
            isbn: json.existing.isbn ?? "",
            existingId: json.existing.id,
            note: `이미 있는 책 — 보유 ${json.existing.total_copies}권에서 한 권 늘립니다`,
          });
          return;
        }
        if (json.upc) {
          patch({
            status: "ISBN필요",
            scanCode: json.upc,
            note: "이 바코드는 상품코드(UPC)입니다 — 표지의 ISBN을 입력해 주세요",
          });
          return;
        }
        if (json.error) {
          patch({ status: "실패", note: json.error });
          return;
        }

        const found = json.found;
        patch({
          isbn: json.canonicalIsbn ?? code,
          title: found?.title ?? "",
          author: found?.author ?? "",
          publisher: found?.publisher ?? "",
          pub_year: found?.pub_year ?? "",
          cover_url: found?.cover_url ?? "",
          language: found?.language ?? "한국어",
          category: found?.category ?? "",
          audience: found?.audience ?? "",
          series: found?.series ?? "",
          seriesNo: found?.seriesNo != null ? String(found.seriesNo) : "",
          status: found ? "준비" : "제목필요",
          note: found ? (found.source ?? "") : "인터넷 목록에 없는 책 — 제목만 적으면 등록됩니다",
        });
      } catch (e) {
        patch({
          status: "실패",
          note: `조회 중 오류 — ${e instanceof Error ? e.message : "인터넷 연결을 확인해 주세요"}`,
        });
      }
    },
    [nextLabelNo]
  );

  /** "같은 책이 여러 권" 이라고 답했을 때 - 담긴 권수를 바로 올립니다. */
  /**
   * 담긴 책이 있는데 창을 닫거나 새로고침하면 전부 사라집니다.
   *
   * 백 권을 찍어 둔 상태에서 실수로 뒤로 가기를 누르면 그 수고가 통째로 날아갑니다.
   * 브라우저가 대신 물어보게 해 둡니다(화면 안에서 메뉴를 누르는 경우는 아래 goAway 가 봅니다).
   */
  useEffect(() => {
    if (items.length === 0) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [items.length]);

  /**
   * 바코드가 없는 책을 목록에 바로 담습니다.
   *
   * 요청: "책을 등록하다가 코드만 있는 경우 다시 또 페이지를 옮겨가야 하는 게 번거로워".
   *
   * 책을 한 칸씩 빼서 쭉 찍어 나가는 중에 바코드 없는 책이 한 권 나오면, 지금까지는 다른
   * 화면으로 가야 했습니다. 돌아오면 담아둔 목록이 사라지고, 칸의 어디까지 했는지도 잃습니다.
   * 그래서 제목만 받아 여기서 바로 담고, 등록할 때 도서관 라벨 번호를 발급받습니다.
   */
  function addNoBarcode(title: string, extra?: Partial<Item>) {
    const name = title.trim();
    if (!name) return;
    const key = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => [
      {
        code: "",
        isbn: "",
        scanCode: null,
        author: "",
        publisher: "",
        pub_year: "",
        cover_url: "",
        category: "",
        audience: "",
        series: "",
        seriesNo: "",
        copies: 1,
        note: "바코드 없음 - 라벨 발급",
        existingId: null,
        coverBlob: null,
        coverPreview: "",
        // 표지에서 읽어낸 값이 있으면 위의 빈 칸들을 덮어씁니다.
        ...extra,
        // 아래 값은 덮어쓰지 않습니다 - 라벨 번호는 여기서만 하나씩 올라가고,
        // 제목과 상태는 이 함수가 정합니다.
        key,
        title: name,
        language: extra?.language ?? (/[가-힣]/.test(name) ? "한국어" : "영어"),
        labelNo: nextLabelNo(),
        status: "준비",
      },
      ...prev,
    ]);
  }

  /**
   * 표지 사진 한 장을 서버로 보내 제목을 읽고, 그 제목으로 찾은 책 후보를 받습니다.
   *
   * 자동으로 1등을 담지 않습니다. 제목 검색은 같은 제목의 다른 책·개정판·세트 상품이 섞여
   * 나오고, 엉뚱한 ISBN이 책에 박히면 몇 달 뒤 누가 그 책을 빌릴 때 드러납니다. 표지 그림이
   * 함께 뜨므로 손에 든 책과 맞는지 사람이 0.5초면 고릅니다.
   */
  async function readShot(dataUrl: string) {
    setCoverBusy(true);
    setCoverError(null);
    setCover(null);
    setEditCrop(false);
    try {
      const res = await fetch("/api/books/cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const json = (await res.json()) as {
        read?: CoverRead;
        candidates?: BookLookup[];
        message?: string;
        error?: string;
      };
      if (!res.ok || !json.read) {
        setCoverError(json.error ?? `표지를 읽지 못했습니다 (HTTP ${res.status})`);
        return;
      }
      const candidates = json.candidates ?? [];
      setCoverTitle(json.read.title);
      /*
        배경을 바로 잘라냅니다. 읽는 쪽이 표지 네모를 함께 집어 주므로 추가 비용이 없고,
        사람이 누를 것도 없습니다. 못 집었으면 사진 전체로 두고 화면에서 끌어 맞추게 합니다.
        2% 넓혀 잘라내는 이유는 coverBox.pad 에 적어 두었습니다.
      */
      const cropped = await cropImage(dataUrl, pad(json.read.box ?? FULL)).catch(() => null);
      setCover({
        shot: dataUrl,
        read: json.read,
        candidates,
        message: json.message,
        cropped: cropped ? { blob: cropped.blob, preview: cropped.preview } : null,
        /*
          출판사가 올린 표지가 있는 후보가 있으면 그쪽이 보통 더 깔끔합니다(정면·균일한 조명).
          그래서 그때는 꺼 두고, 그런 후보가 없을 때만 켭니다 - 표지 없는 책이 남지 않게.
        */
        usePhoto: !candidates.some((b) => b.cover_url),
      });
    } catch (e) {
      setCoverError(
        e instanceof Error ? e.message : "표지를 보내지 못했습니다. 인터넷 연결을 확인해 주세요."
      );
    } finally {
      setCoverBusy(false);
    }
  }

  /** 고친 제목으로 후보를 다시 찾습니다(사진을 다시 읽지 않으므로 비용이 들지 않습니다). */
  async function researchTitle() {
    const title = coverTitle.trim();
    if (title.length < 2 || !cover) return;
    setCoverBusy(true);
    setCoverError(null);
    try {
      const res = await fetch("/api/books/cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, author: cover.read.author }),
      });
      const json = (await res.json()) as {
        candidates?: BookLookup[];
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setCoverError(json.error ?? "다시 찾지 못했습니다.");
        return;
      }
      const candidates = json.candidates ?? [];
      setCover((prev) =>
        prev
          ? {
              ...prev,
              read: { ...prev.read, title },
              candidates,
              message: json.message,
              // 출판사 표지가 있는 후보가 새로 나왔으면 찍은 사진은 기본으로 끕니다.
              usePhoto: prev.usePhoto && !candidates.some((b) => b.cover_url),
            }
          : prev
      );
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : "다시 찾지 못했습니다.");
    } finally {
      setCoverBusy(false);
    }
  }

  /** 후보 하나를 골라 목록에 담습니다(쓰기로 한 경우 찍은 표지도 함께). */
  function takeCandidate(book: BookLookup) {
    const photo = cover?.usePhoto ? (cover.cropped ?? null) : null;
    setCover(null);
    setEditCrop(false);
    if (book.isbn) {
      // ISBN이 있으면 바코드를 찍은 것과 똑같은 길로 보냅니다 - 이미 담겼는지, 장서에 있는
      // 책인지 확인하는 일을 그 길이 전부 하고 있습니다.
      void add(book.isbn, photo ?? undefined);
      return;
    }
    addNoBarcode(book.title, {
      author: book.author ?? "",
      publisher: book.publisher ?? "",
      pub_year: book.pub_year ?? "",
      cover_url: book.cover_url ?? "",
      language: book.language,
      category: book.category ?? "",
      audience: book.audience ?? "",
      series: book.series ?? "",
      seriesNo: book.seriesNo != null ? String(book.seriesNo) : "",
      note: `바코드 없음 - 라벨 발급 · ${book.source}`,
      coverBlob: photo?.blob ?? null,
      coverPreview: photo?.preview ?? "",
    });
  }

  function addCopies(code: string, times: number) {
    setItems((prev) =>
      prev.map((it) => (it.code === code ? { ...it, copies: it.copies + times } : it))
    );
    setDupAsk(null);
  }

  function patchItem(key: string, changes: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...changes } : it)));
  }

  /** 손으로 ISBN을 채워 넣었을 때 다시 조회합니다(UPC 책 등). */
  async function relookup(key: string, isbn: string) {
    patchItem(key, { status: "찾는중" });
    try {
      const res = await fetch(`/api/books/lookup?code=${encodeURIComponent(isbn)}`);
      const json = (await res.json()) as {
        existing?: LibBook | null;
        found?: BookLookup | null;
        canonicalIsbn?: string;
        error?: string;
      };
      if (json.existing) {
        patchItem(key, {
          status: "복본",
          title: json.existing.title,
          existingId: json.existing.id,
          isbn: json.existing.isbn ?? isbn,
          note: `이미 있는 책 — 보유 ${json.existing.total_copies}권에서 한 권 늘립니다`,
        });
        return;
      }
      const found = json.found;
      patchItem(key, {
        isbn: json.canonicalIsbn ?? isbn,
        title: found?.title ?? "",
        author: found?.author ?? "",
        publisher: found?.publisher ?? "",
        pub_year: found?.pub_year ?? "",
        cover_url: found?.cover_url ?? "",
        language: found?.language ?? "한국어",
        category: found?.category ?? "",
        audience: found?.audience ?? "",
        series: found?.series ?? "",
        seriesNo: found?.seriesNo != null ? String(found.seriesNo) : "",
        status: found ? "준비" : "제목필요",
        note: found ? (found.source ?? "") : "인터넷 목록에 없는 책 — 제목만 적으면 등록됩니다",
      });
    } catch {
      patchItem(key, { status: "실패", note: "조회 중 오류" });
    }
  }

  /**
   * 찍은 표지를 저장소에 올리고 주소를 돌려줍니다.
   *
   * 등록할 때 한 번에 올립니다 - 찍는 즉시 올리면, 결국 등록하지 않고 버린 사진까지 저장소에
   * 쌓입니다(지우는 사람은 아무도 없습니다).
   */
  async function uploadCover(blob: Blob, name: string) {
    const safe = name.replace(/[^0-9A-Za-z-]/g, "") || `shot-${Date.now()}`;
    const path = `covers/${safe}.jpg`;
    const { error } = await supabase.storage
      .from("library")
      .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from("library").getPublicUrl(path);
    // 같은 주소에 새 사진을 올리면 브라우저가 옛 사진을 계속 보여줍니다 - 뒤에 표를 붙입니다.
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  /** 목록 전체를 한꺼번에 등록합니다. */
  async function saveAll() {
    setSaving(true);
    let added = 0;
    let moved = 0;
    let failed = 0;
    const ids: string[] = [];

    for (const item of [...items].reverse()) {
      // 제목이 비어 있으면 등록할 수 없습니다(사용자가 채워야 함).
      if (!item.title.trim()) {
        failed += 1;
        patchItem(item.key, { status: "제목필요", note: "제목을 적어주세요" });
        continue;
      }

      /*
        직접 찍은 표지가 있으면 먼저 올립니다. 올리다 실패해도 **책 등록은 그대로 진행**합니다 -
        표지 한 장 때문에 백 권 등록이 멈추면 안 되고, 표지는 장서 관리에서 다시 찍을 수
        있습니다.
      */
      let coverUrl = item.cover_url;
      let coverNote = "";
      if (item.coverBlob) {
        try {
          coverUrl = await uploadCover(item.coverBlob, item.isbn || item.labelNo || item.key);
        } catch (e) {
          coverNote = ` · 표지 사진은 올리지 못했습니다(${
            e instanceof Error ? e.message : "오류"
          })`;
        }
      }

      try {
        const res = await fetch("/api/books", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isbn: item.isbn || null,
            scan_code: item.scanCode ?? (item.isbn ? null : item.code),
            title: item.title,
            author: item.author,
            publisher: item.publisher,
            pub_year: item.pub_year,
            cover_url: coverUrl,
            language: item.language,
            category: item.category || null,
            // 대상 연령은 등록할 때 묻지 않습니다(요청: "이미 연령별로 구분이 된거 같아서
            // 이건 등록할때는 그냥 두고 나중에 다시 분류할때 선택해서"). 조회에서 자동으로
            // 알아낸 값만 넣어두고, 나머지는 장서 관리에서 여러 권씩 골라 한꺼번에 바꿉니다.
            audience: item.audience || null,
            series: item.series || null,
            series_no: item.seriesNo || null,
            label_level: labelLevel || null,
            label_no: item.labelNo || null,
            location_id: locationId || null,
            need_label: needLabel,
            total_copies: item.copies,
          }),
        });
        if (res.status === 401) {
          throw new Error("로그인이 풀렸습니다 — 새로고침 후 다시 로그인하면 담긴 목록은 그대로입니다");
        }
        const json = (await res.json()) as {
          book?: LibBook;
          incremented?: boolean;
          totalCopies?: number;
          error?: string;
        };
        if (!res.ok || !json.book) throw new Error(json.error ?? `등록 실패 (HTTP ${res.status})`);
        if (json.incremented) {
          moved += 1;
          patchItem(item.key, { note: `보유 ${json.totalCopies ?? "?"}권으로 늘림` });
        } else {
          added += item.copies;
          ids.push(json.book.id);
          patchItem(item.key, {
            note:
              (item.copies > 1 ? `${item.copies}권으로 등록 완료` : "등록 완료") + coverNote,
          });
        }
      } catch (e) {
        failed += 1;
        patchItem(item.key, { status: "실패", note: e instanceof Error ? e.message : "등록 실패" });
      }
    }

    setSaving(false);
    setDone({ added, moved, failed, ids });
    router.refresh();
  }

  const ready = items.filter((it) => it.title.trim()).length;
  const location = locations.find((l) => l.id === locationId) ?? null;

  const statusStyle: Record<Status, string> = {
    찾는중: "bg-slate-100 text-slate-500",
    준비: "bg-emerald-100 text-emerald-700",
    제목필요: "bg-amber-100 text-amber-800",
    ISBN필요: "bg-amber-100 text-amber-800",
    복본: "bg-blue-100 text-blue-700",
    실패: "bg-red-100 text-red-700",
  };

  // ── 등록 결과 ───────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="mx-auto max-w-lg space-y-4 pt-6 text-center">
        <p className="text-5xl">✅</p>
        <p className="text-2xl font-bold">
          새로 등록 {done.added}권
          {done.moved > 0 && ` · 복본 추가 ${done.moved}권`}
        </p>
        {location && (
          <p className="text-lg" style={{ color: location.color }}>
            📍 {location.code} {location.name ?? ""}
          </p>
        )}
        {done.failed > 0 && (
          <div className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 text-left">
            <p className="text-base font-bold text-red-800">
              {done.failed}권이 등록되지 않았습니다
            </p>
            <ul className="mt-2 space-y-1.5">
              {items
                .filter((it) => it.status === "실패" || it.status === "제목필요")
                .slice(0, 8)
                .map((it) => (
                  <li key={it.key} className="text-sm leading-relaxed text-red-800">
                    <span className="font-semibold">{it.title || it.code}</span>
                    <br />
                    <span className="font-mono text-xs">{it.note}</span>
                  </li>
                ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                const text = items
                  .filter((it) => it.status === "실패" || it.status === "제목필요")
                  .map((it) => `${it.title || it.code}: ${it.note}`)
                  .join("\n");
                void navigator.clipboard?.writeText(text);
              }}
              className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700"
            >
              오류 내용 복사하기
            </button>
          </div>
        )}

        <div className="space-y-2 pt-2">
          {done.ids.length > 0 && (
            <button
              type="button"
              onClick={() => window.open(`/print/labels?ids=${done.ids.join(",")}`, "_blank")}
              className="w-full rounded-2xl bg-slate-900 px-4 py-3.5 text-base font-bold text-white"
            >
              방금 등록한 {done.ids.length}권 바코드 라벨 인쇄
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setItems((prev) => {
                const keep = prev.filter((it) => it.status === "실패" || !it.title.trim());
                codesRef.current = new Set(keep.map((it) => it.code));
                return keep;
              });
            }}
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600"
          >
            목록으로 돌아가기
          </button>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm("지금 목록을 비우고 새로 시작합니다. 계속할까요?")) return;
              setDone(null);
              codesRef.current.clear();
              setItems([]);
            }}
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600"
          >
            새로 시작하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* DB가 앱보다 뒤처져 있으면 등록 전에 먼저 알려줍니다. */}
      <HealthBanner />

      {/* ── 구역 고르기 + 스캔 ─────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-bold">여러 권 한꺼번에 등록</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          구역을 먼저 고르고 바코드를 주르륵 찍으세요. 책 정보는 찍는 즉시 자동으로 채워지고,
          마지막에 한 번만 누르면 전부 그 구역으로 등록됩니다. <b>같은 책을 또 찍으면</b> 새로
          만들지 않고 <b>보유 권수를 한 권 올립니다</b>.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-500">이 책들을 넣을 구역</span>
          <select
            value={locationId}
            onChange={(e) => {
              const id = e.target.value;
              setLocationId(id);
              // 구역 이름이 '2-3'처럼 <등급>-<칸> 꼴이면 라벨 등급을 자동으로 맞춰줍니다.
              // 라벨 그대로 만든 임시구역이라 매번 손으로 고를 필요가 없습니다.
              const picked = locations.find((l) => l.id === id);
              const m = picked?.code.match(/^\s*([2-9])\s*-\s*\d+\s*$/);
              if (m) setLabelLevel(m[1]);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">나중에 정하기</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.kind === "임시" ? "[임시] " : ""}
                {loc.code}
                {loc.name ? ` · ${loc.name}` : ""}
              </option>
            ))}
          </select>
          {location && (
            <span
              className="rounded-lg px-2.5 py-1 text-sm font-black"
              style={{ background: `${location.color}1f`, color: location.color }}
            >
              📍 {location.code}
            </span>
          )}

          <span className="text-sm font-semibold text-slate-500">지금 라벨</span>
          <select
            value={labelLevel}
            onChange={(e) => setLabelLevel(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            title="지금 책에 붙어 있는 색 라벨의 숫자입니다"
          >
            <option value="">없음</option>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}등급
              </option>
            ))}
          </select>
          <input
            value={labelNext}
            onChange={(e) => setLabelNext(e.target.value)}
            placeholder="시작 번호 (예: 001)"
            className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            title="이 칸 첫 책의 라벨 번호. 한 권 찍을 때마다 자동으로 하나씩 올라갑니다"
          />

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={needLabel}
              onChange={(e) => setNeedLabel(e.target.checked)}
              className="h-4 w-4"
            />
            바코드가 인쇄 안 된 책들 (라벨 발급)
          </label>

          <button
            type="button"
            onClick={() => setCamera((v) => !v)}
            className="ml-auto rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {camera ? "카메라 끄기" : "📷 휴대폰 카메라로 찍기"}
          </button>
        </div>

        {camera ? (
          <div className="mt-4">
            <BarcodeScanner
              continuous
              onDetect={(text) => void add(text)}
              accept={(text) => isBookBarcode(text)}
              hint="책 뒷면 바코드를 하나씩 대면 계속 담깁니다"
            />
          </div>
        ) : (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add(value);
                setValue("");
              }
            }}
            placeholder="여기에 커서를 두고 바코드를 계속 찍으세요"
            className="scan-input mt-4 w-full rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-center outline-none focus:border-gia-gold focus:bg-white"
            autoComplete="off"
            spellCheck={false}
          />
        )}

        {/*
          바코드 없는 책을 여기서 바로 담습니다.

          책을 한 칸씩 빼서 쭉 찍어 나가는 중에 바코드 없는 책이 한 권 나오면, 지금까지는
          다른 화면으로 가야 했습니다. 돌아오면 담아둔 목록이 사라지고 칸의 어디까지 했는지도
          잃습니다. 제목만 적어 넣으면 등록할 때 도서관 라벨 번호를 발급받습니다.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="text-xs font-semibold text-slate-500">바코드 없는 책</span>
          <input
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNoBarcode(manualTitle);
                setManualTitle("");
                setTimeout(refocus, 30);
              }
            }}
            placeholder="책 제목을 적고 Enter — 라벨은 등록 후 한 번에 인쇄합니다"
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            autoComplete="off"
          />
          <button
            type="button"
            disabled={!manualTitle.trim()}
            onClick={() => {
              addNoBarcode(manualTitle);
              setManualTitle("");
              setTimeout(refocus, 30);
            }}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            담기
          </button>
          {/*
            제목을 손으로 치지 않고 표지를 찍습니다. 노트북 카메라 앞에 책을 들면 끝입니다.
            요청: "바코드 없는 책은 휴대폰으로 책 표지 찍으면 자동으로 책 제목 넣어줄 수 있어?
            아니면 노트북 내의 카메라로 찍어서 등록할 수 있게".
          */}
          <button
            type="button"
            onClick={() => {
              setShotOpen((v) => !v);
              setCover(null);
              setCoverError(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              shotOpen ? "bg-slate-200 text-slate-700" : "bg-gia-navy text-white"
            }`}
          >
            {shotOpen ? "표지 촬영 닫기" : "📷 표지 찍기"}
          </button>
        </div>

        {shotOpen && (
          <div className="mt-3 space-y-3">
            <CoverShot
              busy={coverBusy}
              onShot={(dataUrl) => void readShot(dataUrl)}
              onClose={() => {
                setShotOpen(false);
                setCover(null);
                setCoverError(null);
              }}
            />

            {coverError && (
              <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{coverError}</p>
            )}

            {cover && (
              <div className="gia-pop rounded-2xl border-2 border-gia-gold bg-amber-50/60 p-4">
                {/*
                  찍은 사진에서 배경을 잘라낸 표지. 요청: "표지를 찍으면 자동으로 책 표지
                  이외에는 잘려서 깔끔하게 책 표지만 들어갈 수 있도록".
                */}
                {editCrop ? (
                  <CoverCrop
                    src={cover.shot}
                    initial={cover.read.box}
                    label="이 범위로 자르기"
                    onCancel={() => setEditCrop(false)}
                    onDone={(blob, preview) => {
                      setCover((prev) =>
                        prev ? { ...prev, cropped: { blob, preview }, usePhoto: true } : prev
                      );
                      setEditCrop(false);
                    }}
                  />
                ) : (
                <div className="flex gap-3">
                  <div className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={cover.cropped?.preview ?? cover.shot}
                      alt="방금 찍은 표지"
                      className="h-28 w-auto rounded-lg border border-amber-200 bg-white object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setEditCrop(true)}
                      className="mt-1 block w-full text-center text-[11px] text-slate-500 hover:underline"
                    >
                      범위 고치기
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-500">
                      표지에서 읽은 제목 <span className="font-normal">(틀렸으면 고쳐주세요)</span>
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <input
                        value={coverTitle}
                        onChange={(e) => setCoverTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void researchTitle();
                          }
                        }}
                        placeholder="읽지 못했습니다 — 제목을 적어주세요"
                        className="min-w-[12rem] flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-lg font-bold text-gia-navy"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => void researchTitle()}
                        disabled={coverBusy || coverTitle.trim().length < 2}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 disabled:opacity-40"
                      >
                        {coverBusy ? "찾는 중…" : "이 제목으로 다시 찾기"}
                      </button>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {[cover.read.author, cover.read.publisher, cover.read.series]
                        .filter(Boolean)
                        .join(" · ") || "저자·출판사는 표지에서 보이지 않았습니다"}
                    </p>
                    {cover.message && (
                      <p className="mt-1 text-sm text-amber-800">{cover.message}</p>
                    )}

                    {/*
                      요청: "찍은 거 바로 표지 등록할 수 있게". 출판사 표지가 있는 후보가
                      있으면 기본으로 꺼 둡니다 - 정면에서 균일한 조명으로 찍은 출판사 표지가
                      보통 더 깔끔합니다. 그런 후보가 없으면 켜 둡니다(표지 없는 책이 남지
                      않게).
                    */}
                    {cover.cropped && (
                      <label className="mt-2 flex w-fit items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={cover.usePhoto}
                          onChange={(e) =>
                            setCover((prev) =>
                              prev ? { ...prev, usePhoto: e.target.checked } : prev
                            )
                          }
                          className="h-4 w-4"
                        />
                        이 사진을 표지로 쓰기
                      </label>
                    )}
                  </div>
                </div>
                )}

                {cover.candidates.length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-semibold text-slate-500">
                      이 중에 손에 든 책이 있나요? 고르면 ISBN·출판사·표지까지 함께 등록되고,
                      라벨에 그 ISBN 바코드가 찍혀 다음부터는 스캐너로 그냥 읽힙니다.
                    </p>
                    <ul className="mt-2 space-y-2">
                      {cover.candidates.map((book, i) => (
                        <li key={`${book.isbn}-${i}`}>
                          <button
                            type="button"
                            onClick={() => takeCandidate(book)}
                            className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-left hover:border-gia-gold hover:bg-amber-50"
                          >
                            {book.cover_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={book.cover_url}
                                alt=""
                                className="h-16 w-12 flex-shrink-0 rounded object-cover"
                              />
                            ) : (
                              <span className="flex h-16 w-12 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400">
                                표지
                                <br />
                                없음
                              </span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block font-bold break-words text-gia-navy">
                                {book.title}
                              </span>
                              <span className="mt-0.5 block text-sm text-slate-600">
                                {[book.author, book.publisher, book.pub_year]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                              <span className="mt-0.5 block text-xs text-slate-400">
                                {book.isbn ? `ISBN ${book.isbn}` : "ISBN 없음"} · {book.source}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {coverTitle.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        const read = cover.read;
                        const title = coverTitle.trim();
                        const photo = cover.usePhoto ? (cover.cropped ?? null) : null;
                        setCover(null);
                        setEditCrop(false);
                        addNoBarcode(title, {
                          author: read.author ?? "",
                          publisher: read.publisher ?? "",
                          series: read.series ?? "",
                          seriesNo: read.volume ?? "",
                          note: "바코드 없음 - 라벨 발급 · 표지에서 읽음",
                          coverBlob: photo?.blob ?? null,
                          coverPreview: photo?.preview ?? "",
                        });
                      }}
                      className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white"
                    >
                      {cover.candidates.length > 0
                        ? "맞는 책이 없음 — 읽은 제목으로 담기"
                        : "읽은 제목으로 담기"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setCover(null)}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600"
                  >
                    버리고 다시 찍기
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 같은 바코드를 또 찍었을 때 ─────────────────────────────────── */}
      {dupAsk && (
        <div className="gia-pop rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-base font-bold text-amber-900">
            이 책은 이미 담겨 있습니다 — {dupAsk.title}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {dupAsk.times > 1 && <b>{dupAsk.times}번 더 찍혔습니다. </b>}
            잘못해서 두 번 찍으신 건가요, 아니면 같은 책이 여러 권 있나요?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => addCopies(dupAsk.code, dupAsk.times)}
              className="rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white"
            >
              같은 책이 여러 권 — {dupAsk.times}권 추가
            </button>
            <button
              type="button"
              onClick={() => setDupAsk(null)}
              className="rounded-xl border border-amber-300 bg-white px-5 py-2.5 text-sm font-semibold text-amber-800"
            >
              잘못 찍었어요 (무시)
            </button>
          </div>
        </div>
      )}

      {/* ── 담긴 목록 ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-500">
          담긴 책 {items.length}권 {items.length > 0 && `(등록 준비 ${ready}권)`}
        </span>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // 찍은 것을 통째로 버리는 일입니다. 되돌릴 방법이 없어 한 번 묻습니다.
              if (
                !window.confirm(
                  `담긴 책 ${items.length}권을 전부 지웁니다.\n\n` +
                    "지우면 되돌릴 수 없고, 처음부터 다시 찍어야 합니다. 정말 비울까요?"
                )
              ) {
                return;
              }
              codesRef.current.clear();
              setItems([]);
            }}
            className="text-sm text-slate-400 hover:underline"
          >
            전체 비우기
          </button>
        )}
        <button
          type="button"
          disabled={saving || ready === 0}
          onClick={() => void saveAll()}
          className="ml-auto rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
        >
          {saving ? "등록 중…" : `${ready}권 한꺼번에 등록`}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {items.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-slate-400">
            아직 찍은 책이 없습니다. 위 칸에 커서를 두고 바코드를 찍어보세요.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.key} className="flex items-start gap-3 px-4 py-3">
                {item.coverPreview || item.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.coverPreview || item.cover_url}
                    alt=""
                    className={`h-14 w-10 shrink-0 rounded object-cover ${
                      item.coverPreview ? "ring-2 ring-gia-gold" : ""
                    }`}
                    title={item.coverPreview ? "직접 찍은 표지 - 등록할 때 함께 올립니다" : undefined}
                  />
                ) : (
                  <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-sm">
                    📘
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${statusStyle[item.status]}`}
                    >
                      {item.status}
                    </span>
                    {item.copies > 1 && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                        {item.copies}권
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-slate-400">
                      {item.isbn ? formatIsbn(item.isbn) : item.code}
                    </span>
                    {item.note && <span className="text-[11px] text-slate-400">{item.note}</span>}
                  </div>

                  {item.status === "ISBN필요" ? (
                    <input
                      key={`${item.key}-isbn`}
                      defaultValue=""
                      placeholder="표지에 적힌 ISBN을 입력하고 Enter"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void relookup(item.key, (e.target as HTMLInputElement).value);
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-amber-300 px-2 py-1.5 text-sm"
                    />
                  ) : (
                    <input
                      key={`${item.key}-title`}
                      value={item.title}
                      onChange={(e) => patchItem(item.key, { title: e.target.value })}
                      placeholder="제목을 적어주세요"
                      disabled={item.existingId !== null}
                      className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-sm ${
                        item.title.trim() ? "border-transparent hover:border-slate-200" : "border-amber-300"
                      } ${item.existingId ? "text-slate-400" : ""}`}
                    />
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {item.author && (
                      <span className="truncate text-xs text-slate-400">{item.author}</span>
                    )}
                    {item.category && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                        {item.category}
                      </span>
                    )}
                    {item.series && (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700">
                        📚 {item.series}
                        {item.seriesNo ? ` ${item.seriesNo}권` : ""}
                      </span>
                    )}
                    {labelLevel && item.status !== "복본" && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-400">
                        라벨 {labelLevel}-
                        <input
                          value={item.labelNo}
                          onChange={(e) => patchItem(item.key, { labelNo: e.target.value })}
                          placeholder="번호"
                          className="w-16 rounded border border-slate-200 px-1 py-0.5 text-center"
                        />
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    codesRef.current.delete(item.code);
                    setItems((prev) => prev.filter((it) => it.key !== item.key));
                  }}
                  className="shrink-0 text-xs text-slate-400 hover:text-red-500"
                >
                  빼기
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
