import LoginForm from "./LoginForm";

const MESSAGES: Record<string, string> = {
  domain: "회사 계정(giamicro.com) 또는 도서관 전용 계정으로만 접속할 수 있습니다.",
  auth: "로그인에 실패했습니다. 다시 시도해 주세요.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? (MESSAGES[error] ?? MESSAGES.auth) : null;

  return (
    <main className="gia-navy-panel flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-main.png" alt="GIA Micro Lab" className="mx-auto mb-5 h-9 w-auto" />
          <h1 className="text-lg font-bold text-gia-navy">도서관 대출·반납</h1>
          <p className="mt-1 mb-6 text-sm text-slate-500">학생 도서카드로 이용 기록을 남깁니다</p>
        </div>

        {message && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
        )}

        <LoginForm />
      </div>
    </main>
  );
}
