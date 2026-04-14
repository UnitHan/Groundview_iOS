# GroundView iOS 설계 가이드

## 아키텍처 개요
- `core-ui`/`core-logic` 재사용, iOS 전용 어댑터(`ios-agent`)로 WDA 호출을 담당.
- 데이터 플로우: WDA `/status` → `/screenshot` + `/source` → 정규화/매칭 → 로케이터/코드 생성 → UI 표시.
- 포트/어댑터 패턴: UI ↔ 서비스 ↔ WDA 어댑터, 플랫폼 의존 코드는 어댑터에 한정.

## 수집/정합
- 디바이스 목록: `xcrun xctrace list devices` → 시뮬레이터/실기기 분리, 직렬/OS 버전 표시.
- 캡처: `/screenshot`(PNG) + `/source`(json/xml), 타임아웃/재시도(기본 10s, 2회).
- 정규화: 해상도/회전 메타 수집, px→비율(0~1) 변환, 텍스트 병합.

## 로케이터 우선순위
1. Accessibility Id
2. iOS Predicate (`AppiumBy.IOS_PREDICATE`)
3. iOS Class Chain (`AppiumBy.IOS_CLASS_CHAIN`)
4. 좌표/이미지 fallback
- XPath는 최후 수단으로 별도 섹션에 표시.

## 코드 템플릿(예시)
- Python(Appium 2/3):
```python
from appium import webdriver
from appium.webdriver.common.appiumby import AppiumBy
el = driver.find_element(AppiumBy.IOS_PREDICATE, "name == 'Settings'")
el.click()
```
- Java(Appium 2/3):
```java
import io.appium.java_client.AppiumBy;
WebElement el = driver.findElement(AppiumBy.iOSNsPredicateString("name == 'Settings'"));
el.click();
```
- 좌표 fallback:
```python
driver.execute_script("mobile: tap", {"x": 120, "y": 240})
```

## UX 가이드
- 온보딩: iOS READY 카드(상태/버전/포트), WDA 수동 빌드 안내, “Check WDA” 버튼.
- 디바이스 선택: 시뮬레이터/실기기 구분, 선택 후 `Capture Screen` 활성화.
- 메인 분석 뷰: 좌측 스크린샷(줌/리테이크), 우측 트리/검색/코드 탭(Appium 1/2/3, Python/Java).
- 오류 안내: WDA 미응답/포트 충돌/서명 문제에 대한 단문 가이드와 재시도 버튼.

## 빌드/배포
- macOS 전용 dmg/zip(`npm run dist`), iOS 기능만 포함.
- WDA 자동 빌드는 지원하지 않음; 헬스 체크와 가이드만 제공.

## 테스트 체크리스트
- WDA 헬스 체크(응답/포트/번들ID) OK/Fail 케이스.
- 디바이스 리스트 파싱(xctrace/idevice_id).
- 캡처 흐름: `/screenshot` 실패 → 재시도/오류 표시, `/source` 파싱 및 트리 빌드.
- 로케이터 생성: AccId/Predicate/Class Chain 우선, XPath 최소화, 코드 스니펫 출력.
