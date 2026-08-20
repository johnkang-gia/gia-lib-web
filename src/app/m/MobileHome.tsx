"use client";

import { useRouter } from "next/navigation";

const MENU = [
  {
    href: "/m/add",
    icon: "📚",
    label: "새 책 등록",
    desc: "바코드 찍기 → 표지 찍기 → 등록",
    primary: true,
  },
  { href: "/find", icon: "🔎", label: "책 찾기", desc: "제목으로 찾고 구역 확인" },
  { href: "/scan", icon: "📕", label: "대출·반납 화면", desc: "노트북용 화면 열기" },
];

export default function MobileHome() {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <p className="px-1 pb-1 text-sm text-slate-500">휴대폰으로 할 일을 골라주세요</p>

      {MENU.map((item) => (
        <button
          key={item.href}
          type="button"
          onClick={() => router.push(item.href)}
          className={`flex w-full items-center gap-4 rounded-2xl px-5 py-5 text-left shadow-sm ${
            item.primary ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"
          }`}
        >
          <span className="text-3xl">{item.icon}</span>
          <span>
            <span className="block text-lg font-bold">{item.label}</span>
            <span className={`block text-sm ${item.primary ? "text-white/60" : "text-slate-400"}`}>
              {item.desc}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
