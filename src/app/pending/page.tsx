import SignOutButton from "@/components/SignOutButton";

// 회사 계정이지만 운영앱(gia-ops)에서 아직 승인되지 않은 사람이 들어왔을 때 보이는 화면입니다.
export default function PendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-bold">아직 사용 권한이 없습니다</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          이 계정은 운영앱(GIA 운영)의 계정 관리에서 <b>승인</b> 상태가 아닙니다.
          <br />
          도서관 공용 계정이라면 관리자에게 승인 처리를 요청하시고, 개인 교직원 계정이라면
          운영앱에서 계정 승인을 먼저 받아주세요.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
