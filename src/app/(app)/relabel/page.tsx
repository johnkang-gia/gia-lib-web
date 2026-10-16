import RelabelClient from "./RelabelClient";

export const dynamic = "force-dynamic";

/**
 * 재등록 · 라벨 뽑기 — 상품코드로 들어가 있는 책을 ISBN 으로 바꿔 적습니다.
 *
 * 요청: "상품코드로 되어있는 책들 전부 다시 등록해서 라벨 뽑고 붙이려고 하거든 ... 바코드를
 * 찍으면 기존에 상품코드로 등록이 되어 있다면 ISBN 기입할 수 있게 해주고, 기입하면 책 정보를
 * 바탕으로 교체등록해주고 라벨을 뽑을 수 있게 모아뽑기에 저장할 수 있게 해줘."
 *
 * 서버에서 아무것도 읽지 않습니다 - 이 화면이 하는 일은 전부 '찍은 다음'에 일어납니다.
 */
export default function RelabelPage() {
  return <RelabelClient />;
}
