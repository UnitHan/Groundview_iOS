# GroundView iOS 개발 계획

## 목표
- 기존 GroundView(안드로이드)와 동일한 화면 그라운딩·로케이터 생성 경험을 iOS(WDA) 환경으로 확장한다.
- 공통 UI/로직(core)을 재사용하고, iOS 특화 수집(스크린샷+source)과 로케이터(Class Chain/Predicate/AccId) 생성 파이프라인을 제공한다.
- Appium 1/2/3, Python/Java 코드 스니펫을 iOS 템플릿으로 출력하고, 버튼 전수 클릭 스크립트까지 자동 생성한다.

## 범위
- 필수: WDA 연동(상태 체크, source/screenshot 수집), 요소 정렬/매칭, 로케이터 생성, 코드 스니펫/일괄 스크립트 출력, 데스크톱 UI와 동일한 분석 뷰.
- 확장: 히스토리/비교, 배치 처리, 로케이터 안정성 점수화, 템플릿 커스터마이즈, CLI/SDK 노출.
- 비범위: WDA 자동 빌드/서명, 클라우드 디바이스 팜 구축.

## 마일스톤(예시 6주)
- W1: 요구 정리, WDA 상태/장치 리스트 POC, source/screenshot 수집 실험.
- W2: 화면-트리 정렬/매칭, 로케이터 생성(AccId/Predicate/Class Chain 우선) 초안.
- W3: 데스크톱 UI iOS 분기(READY 카드, 디바이스 선택, 캡처 플로우), 코드 템플릿(Appium 1/2/3, Python/Java).
- W4: 버튼 전수 스크립트, 품질 지표, CLI/SDK 초안.
- W5: 안정화(매칭/점수 튜닝), 다국어/OCR, 히스토리/비교.
- W6: QA, dmg/zip 패키징, 문서화/예제.

## 작업 항목(요약 백로그)
- 수집: `xcrun xctrace list devices` or `idevice_id -l`, WDA `/status` 헬스, `/screenshot`, `/source`(json/xml) 호출.
- 정합: 스크린샷-트리 좌표 정규화, 폴리곤/바운딩 매칭, 텍스트 병합.
- 로케이터 생성: AccId > iOS Predicate > Class Chain > 좌표/이미지 fallback, XPath 최소화.
- 코드 생성: Appium 1/2/3, Python/Java 템플릿; 버튼 일괄 스크립트.
- UI/UX: 온보딩 iOS READY 카드, 디바이스 선택/캡처, 메인 분석 뷰(공통 재사용).
- 배포: macOS 전용 dmg/zip, WDA 수동 빌드 안내 포함.

## 위험 & 대응
- WDA 미응답/포트 충돌: 상태 체크/재시도, 포트 변경 가이드.
- 개발자 계정/서명 이슈: 수동 빌드 전제 안내, 에러별 해결 링크 제공.
- OCR/객체 검출 품질: 다국어 언어팩, 전처리, 모델 경량화.
- 성능: 한 화면 처리 <3s 목표, 캐시/NMS 최적화.

## 성공 지표
- WDA 연결 성공률, 캡처→분석까지 소요 시간.
- Inspector 미포착 요소 추가 식별률(텍스트/버튼 기준).
- 자동 생성 스크립트 실행 성공률, 로케이터 안정성 점수.
