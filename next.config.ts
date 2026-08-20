import type { NextConfig } from "next";

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
