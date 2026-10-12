import type { NextConfig } from "next";

/*
  이 파일이 바뀌면 Vercel 의 빌드 캐시가 다시 만들어집니다. v0.46.0 배포가 연달아 실패했는데,
  같은 커밋을 GitHub Actions 에서 npm ci + next build 로 돌리면 통과하고 이 자리에서 .next 를
  지우고 다시 빌드해도 통과했습니다. 코드가 아니라 쌓여 있던 캐시 쪽일 수 있어 한 번 흔듭니다.
*/

const nextConfig: NextConfig = {
  images: {
    // ISBN 조회로 받아오는 책 표지 이미지 주소들입니다. next/image 대신 <img>를 쓰고 있어
    // 지금은 쓰이지 않지만, 나중에 next/image로 바꿀 때를 위해 남겨둡니다.
    remotePatterns: [
      { protocol: "https", hostname: "**.googleusercontent.com" },
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "image.aladin.co.kr" },
      { protocol: "https", hostname: "**.nl.go.kr" },
    ],
  },
};

export default nextConfig;
