import { redirect } from "next/navigation";

// 첫 화면은 언제나 대출/반납 스캔 화면입니다(도서관 노트북이 하루 종일 켜두는 화면).
export default function Home() {
  redirect("/scan");
}
