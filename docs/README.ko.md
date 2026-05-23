# Neat Pulse 설정 내보내기 도구

**[English](../README.md)** · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [繁體中文](./README.zh-TW.md) · [简体中文](./README.zh-CN.md)

---

[Neat Pulse API](https://api.pulse.neat.no/docs/)에서 디바이스별 설정을 CSV 파일로 내보내어 회의실 디바이스의 Excel 인벤토리와 대조하기 위한 소형 Node.js 웹 도구입니다.

> ⚠️ **비공식 도구입니다.** Neat 사와 무관하며, 공식적으로 승인된 도구가 아닙니다. 공개 문서에 기재된 엔드포인트만을 제공된 API 키로 호출합니다.

## 기능

- **룸 단위**로 디바이스를 순회합니다(`GET /orgs/{org}/rooms` → `GET /orgs/{org}/rooms/{id}`). 따라서 위치(Location) 및 지역(Region) 정보가 포함됩니다.
- 각 디바이스의 현재 설정(`GET /endpoints/{id}/config`)과 할당된 프로파일(`GET /profiles/{profileId}`)을 가져옵니다.
- 각 설정 키에 대해 3가지 열을 출력합니다:
  - `config.*` — 디바이스에 직접 기록된 값
  - `profile.*` — 할당된 프로파일에 선언된 값
  - `effective.*` — 디바이스 우선·프로파일 보완의 병합 값
- base64로 인코딩된 MAC / IPv4 / IPv6 / 게이트웨이 필드를 디코딩하고 스토리지를 GB 단위로 표시합니다.
- Server-Sent Events를 통해 브라우저에 진행 상황을 실시간으로 표시합니다.
- 패스워드·토큰·시크릿 등 민감한 키의 값을 자동으로 마스킹합니다(`settingsPasswordRequired` 같은 플래그는 제외).
- Excel에서 UTF-8을 올바르게 열 수 있도록 CSV에 UTF-8 BOM을 추가합니다.

## 검증된 규모

실제 운영 테넌트(**560개 엔드포인트, 296개 룸, 25개 프로파일, 11개 모델**)에서 오류 0건으로 전체 내보내기를 완료했습니다. 기본값 `CONCURRENCY=3`은 이 규모에서 API 속도 제한을 피하기 위해 설정되었습니다. 소규모 환경에서는 높여도 됩니다.

## 요구 사항

- Node.js 18 이상(글로벌 `fetch` 사용)
- Neat Pulse **Plus** 또는 **Pro** 구독(API 키 발급에 필요)
- **Pulse → Settings → API**에서 발급한 API 키
- 조직 ID(`orgId`)

## 설치 및 시작

```bash
git clone https://github.com/yuki-iwagishi/neat-pulse-exporter.git
cd neat-pulse-exporter
npm install
cp .env.example .env   # 선택 사항, 아래 참조
npm start
```

브라우저에서 <http://127.0.0.1:3000>을 열어주세요.

### `.env`를 통한 설정 (선택 사항)

`.env.example`을 `.env`로 복사한 후 값을 입력합니다. 모든 변수는 생략 가능합니다.

| 변수명          | 기본값      | 설명                                                              |
| --------------- | ----------- | ----------------------------------------------------------------- |
| `PORT`          | `3000`      | HTTP 수신 포트                                                    |
| `HOST`          | `127.0.0.1` | 바인드 주소. LAN 공개 시에만 `0.0.0.0` 사용                      |
| `CONCURRENCY`   | `3`         | Pulse API 최대 동시 요청 수                                       |
| `PULSE_API_KEY` | _(비어 있음)_ | 설정하면 UI 입력 생략 가능                                        |
| `PULSE_ORG_ID`  | _(비어 있음)_ | 위와 동일(조직 ID)                                               |

> **실제 `.env`는 절대 커밋하지 마세요.** `.gitignore`에 등록되어 있습니다.

## 사용 방법

1. `npm start` 실행 후 브라우저로 페이지를 엽니다.
2. API 키와 조직 ID를 입력합니다(`.env`에 이미 설정된 경우 생략 가능).
3. **CSV로 내보내기**를 클릭합니다. 진행 상황이 실시간으로 표시됩니다.
4. 완료되면 CSV 다운로드가 자동으로 시작됩니다.

CSV는 디바이스 1대당 1행입니다. 열은 모든 디바이스의 키를 합집합하여 알파벳 순으로 정렬하므로 서로 다른 모델이 혼재해도 하나의 파일에 담깁니다.

## 커스터마이즈

### 민감한 필드 마스킹

`src/server.js`의 `isSecretKey()` 함수가 마스킹 대상을 판별합니다. 키 이름에 `password`, `secret`, `token`, `apiKey`, `privateKey`, `credential`이 포함된 경우 값을 `***MASKED***`로 치환합니다. 필요에 따라 패턴을 수정하세요.

### Excel 시트 열에 맞추기

기본적으로 API가 반환하는 모든 키가 열이 됩니다. Excel의 고정 열 구조에 맞추려면 Excel에서 `VLOOKUP` / Power Query를 사용하거나, `/api/export` 내의 `buildRow()` 함수를 수정하여 필요한 키만 출력하도록 변경하세요.

## Pulse API의 알려진 제한 사항

실제 Pulse API를 대상으로 조사·확인한 내용입니다(2026년 5월).

### 1. 모델별 키

일부 설정은 해당 디바이스 모델이 지원하는 경우에만 `/endpoints/{id}/config`에 포함됩니다. 예를 들어 `hdmiSleepSignal`은 Neat Bar Pro에서는 지원되지만 구형 Neat Bar에서는 포함되지 않습니다. 지원하지 않는 모델은 `config.hdmiSleepSignal`이 비어 있지만 `effective.*`는 프로파일 값으로 보완합니다(단, 실제 디바이스에 적용된다는 의미는 아닙니다).

### 2. 프로파일 상속 값은 디바이스 설정에서 생략됨

`GET /endpoints/{id}/config`는 디바이스에 **명시적으로 기록된 키만** 반환합니다. 프로파일에서 상속된 값은 자동으로 생략됩니다. 이는 Pulse의 정상적인 동작입니다. 이 도구는 프로파일도 함께 가져와서 병합하고 `effective.*`에 반영합니다.

### 3. 프로파일 잠금 설정의 로컬 재정의

프로파일 적용 시 Pulse UI는 설정을 "locked by profile"로 표시하지만, 디바이스 본체의 UI에서 재정의가 가능합니다. 재정의 시 Pulse UI에 경고("A locked profile setting has been changed on this device")가 표시됩니다. 재정의된 값은 `/endpoints/{id}/config`에 반영되므로 `effective.*`는 올바른 값을 나타냅니다. 단, **어떤 키가 재정의 상태인지는 API에서 판별할 수 없습니다**. `_source.*` 열로 디바이스 기원인지 프로파일 기원인지 확인할 수 있지만, 재정의 상태 감지는 Pulse UI에서 직접 확인이 필요합니다.

### 4. `office_hours`(수면 일정)는 쓰기 전용

수면 일정 토글과 시간 범위(내부 키 이름 `office_hours`, `office_hours_enabled`)는 UI에서 설정 가능하고 감사 로그에도 기록되지만, 어떤 Read API 엔드포인트에서도 반환되지 않습니다. CSV로 내보낼 수 없으므로 Excel 대조는 수동으로 진행해야 합니다. Neat에 보고된 상태입니다.

### 5. 기타 쓰기 전용 키

560개 엔드포인트 규모 테넌트를 대상으로 한 조사에서, **24개 키**가 `office_hours`와 동일하게 쓰기 전용(Read API 미포함)임을 확인했습니다:

**Channel apps(16개)** — 앱별 활성화 토글은 일절 반환되지 않습니다:

```
channelAppsAppspace      channelAppsKahoot       channelAppsSmartenspaces
channelAppsAround        channelAppsMiro         channelAppsSpotify
channelAppsBrowser       channelAppsRobin        channelAppsTeams
channelAppsHubspot       channelAppsSlack        channelAppsTrello
channelAppsJira          channelAppsZoom         channelAppsWhatsapp
                                                  channelAppsWorkplace
```

**기타 쓰기 전용 키:**

```
homeApp                       avosChannel
kioskMode                     scheduledFirmwareUpdateDelay
ngmsEnabled                   settingsPassword
ngmsFeatureToggle             settingsPasswordMode
```

`settingsPassword`와 원격 접속 비밀번호는 보안상의 이유로 생략되며, 나머지는 Read API 미구현으로 판단됩니다. `office_hours` 건과 함께 Neat에 보고되었습니다.

### 커버리지 요약

프로파일이 할당된 일반적인 디바이스에서는 Pulse UI에 표시되는 설정 중 **약 35 / 45개**를 `profile.*`로 가져올 수 있으며, `pairingSerial`, `wifiEnabled` 등 14개의 디바이스 전용 키를 `config.*`로 추가로 취득할 수 있습니다. 위의 24 + 2개 키는 Neat가 Read API에서 공개할 때까지 취득 불가입니다.

## 보안 관련 주의 사항

- **API 키는 브라우저에서 로컬 Node 프로세스로 POST 요청 본문을 통해 전송됩니다.** URL 쿼리 파라미터에 포함되지 않으며, 로깅·저장은 일절 이루어지지 않습니다.
- **내보낸 CSV에는 네트워크 정보**(MAC 주소, IP 주소, 룸·위치 메타데이터)가 포함될 수 있습니다. 다른 기밀 문서와 동일하게 취급하세요.
- **기본적으로 `127.0.0.1`에 바인딩됩니다.** `HOST`를 비루프백 주소로 설정하면 서버 시작 시 경고가 표시되고 UI에 배너가 나타납니다. 동일 네트워크의 누구나 내보내기를 실행할 수 있는 상태가 됩니다.
- **Web UI에 인증 기능이 내장되어 있지 않습니다.** 팀 공유 시에는 기존 SSO / 리버스 프록시 뒤에 배치하거나 Electron 데스크톱 앱으로 패키징하세요.

### 시크릿 감지의 한계

키 이름 패턴(`password`, `secret`, `token`, `apiKey`, `privateKey`, `credential`)으로 마스킹 대상을 판별합니다. 이 방법에는 알려진 한계가 있습니다:

| 유형 | 오처리 가능 키 예시 |
|------|-------------------|
| 과잉 마스킹(오탐) | `secretariatMode`, `tokenRefreshInterval` |
| 마스킹 누락(미탐) | `pwd`, `clientKey`, `bearer`, `passphrase` |

**외부 공유 전에 반드시 내보낸 CSV 파일을 직접 확인하세요.**

## 프로젝트 구성

```
neat-pulse-exporter/
├── docs/
│   ├── api_findings.md        # Pulse API 조사 기록
│   ├── README.ja.md           # 日本語
│   ├── README.ko.md           # 이 파일
│   ├── README.zh-TW.md        # 繁體中文
│   └── README.zh-CN.md        # 简体中文
├── examples/
│   └── sample_output_columns.txt   # CSV 열 목록 샘플
├── public/
│   └── index.html        # Web UI (빌드 불필요)
├── src/
│   └── server.js         # Express 서버 + Pulse API 클라이언트
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── package.json
└── README.md             # English
```

## 트러블슈팅

| 증상 | 원인 / 대처법 |
|------|-------------|
| `Pulse API 401` | API 키가 유효하지 않거나 만료됨. Pulse Settings에서 재발급하세요 |
| `Pulse API 403` | 키에 Read 권한이 없거나 플랜이 API를 지원하지 않습니다 |
| `/profiles/{id}`에서 `Pulse API 404` | 디바이스에 프로파일이 할당되지 않음. 행은 내보내지지만 `profile.*` 열은 비어 있습니다 |
| `_configError` 열에 값이 있음 | `/config` 가져오기 오류(타임아웃 등). 다른 열은 유효합니다 |
| `endpoints` 배열이 비어 있음 | `orgId`가 잘못되었거나 키가 다른 조직의 것입니다 |
| Excel에서 깨진 문자 표시 | Excel 2016 미만은 BOM을 무시할 수 있습니다. 「데이터 → 텍스트/CSV에서」로 가져오기하세요 |

## 향후 개선 과제

- **IPv6 주소 RFC 5952 압축** — 현재 비압축 형식으로 출력. 가독성 향상을 위해 향후 대응 예정.
- **대규모 테넌트를 위한 스트리밍 CSV** — 현재 모든 행을 메모리에 보관 후 출력. 수천 대 규모에서 메모리 급증 가능성이 있습니다.
- **세션 / 잡 분리** — SSE 진행 스트림과 CSV 다운로드를 분리하여 장시간 내보내기의 안정성 향상.

## 라이선스

MIT — [LICENSE](../LICENSE)를 참조하세요.
