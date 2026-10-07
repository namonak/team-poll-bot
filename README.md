# Team Poll Bot 🐻

`투표곰`은 Teams 단체 대화방에서 함께 고를 후보와 마음을 모아주는 봇이에요.
`team-meal-bot`의 서버·카드·SQLite·Docker 배포 구조를 활용하고, 투표곰만의 생성·투표 흐름으로 동작해요.

## 기능

- `@투표곰`을 입력하면 투표 만들기 명령을 제안해요. 전송하면 도움말 카드를 펼쳐요.
- 제목, 후보 2~10개, 선택 마감, 복수 선택 여부를 폼에 담아 투표를 시작해요.
- 준비 카드를 부른 분만 투표를 시작할 수 있어요. 준비 카드는 24시간 동안 사용할 수 있어요.
- 후보는 한 줄에 하나씩 적어요. `식당 이름 (https://naver.me/xxxx)`처럼 구경할 링크도 담을 수 있어요.
- 투표할 때마다 같은 결과판에 참여 인원, 총 표 수, 후보별 표 수와 이름을 갱신해요.
- 마감 전에는 다시 골라서 마음을 바꿀 수 있어요. 같은 분의 이전 응답은 새 선택으로 바꿔 담아요.
- 한 후보 선택 또는 여러 후보 선택을 지원해요. 복수 투표의 비율은 참여자 기준이라 합계가 100%를 넘을 수 있어요.
- 정해진 시각 또는 작성자의 버튼으로 마감해요. 마감을 비우면 작성자가 닫을 때까지 열어둬요.
- 대화방마다 따로 저장해요. 공개 기명 투표이므로 고른 후보와 이름은 같은 대화방 구성원에게 보여요.

실시간은 응답 저장 직후 기존 Teams 메시지를 갱신하는 방식이에요. 클라이언트 표시에는 잠깐의 지연이 있을 수 있어요.
결과판 갱신이 실패해도 선택은 보존하고 30초마다 다시 시도해요. `🔄 최신 결과 보기` 버튼으로도 펼칠 수 있어요.

## 대화방 명령

| 입력 | 동작 |
| --- | --- |
| `@투표곰` | 투표곰 사용 방법을 알려줘요. |
| `@투표곰 투표만들기` | 빈 준비 카드를 펼쳐요. |
| `@투표곰 투표만들기 테스트2` | 제목에 ‘테스트2’를 미리 담아요. |
| `@투표곰 투표만들기 + 준비곰 목록` | 일괄 입력용 빈 준비 카드를 펼쳐요. |
| `@투표곰 투표만들기 + "점심" "식당 A" "식당 B" 마감: "금요일 18시" 복수` | 제목·후보·마감·복수 선택을 미리 담아요. |

일괄 입력은 첫 큰따옴표 값이 제목, 다음 값들이 후보예요. `마감:`과 `복수`는 생략할 수 있어요.
값 안에 큰따옴표를 넣으려면 `\"`, 역슬래시는 `\\`로 적어요.
어느 명령이든 폼을 확인하고 `🐻 투표 시작!`을 눌러야 투표가 시작돼요.
Teams 자동완성 메뉴의 모양은 클라이언트 버전과 테마에 따라 달라질 수 있어요.

### 마감 시간

모든 마감은 한국 시간이에요. 폼을 제출하는 순간을 기준으로 해석하고 결과판에 실제 마감 날짜를 표시해요.

| 입력 | 뜻 |
| --- | --- |
| 빈 값 | 자동 마감 없이 열어둬요. |
| `30분`, `3시간`, `2일` | 제출 시각부터 해당 기간 뒤에 닫아요. 양의 정수만 가능해요. |
| `금요일 18시`, `금요일 18:30` | 가장 가까운 미래의 해당 요일·시각이에요. 이미 지났으면 다음 주예요. |
| `8월 22일 18시`, `8월 22일 18:30` | 올해 해당 시각이에요. 이미 지났으면 다음 해예요. |
| `2026-10-09 18:00` | 날짜와 시각을 정확히 지정해요. 이미 지난 값은 사용할 수 없어요. |

마감은 365일 이내로 정해줘요. 달력에 없는 날짜는 자동으로 고치지 않고 다시 물어봐요.
마감 시각부터 새 응답을 받지 않으며, 결과판의 마감 표시는 다음 주기 작업까지 최대 약 30초 늦을 수 있어요.
시작 뒤에는 제목·후보·설정을 바꿀 수 없어요. 정정하려면 새 투표로 다시 모아줘요.

## 서버 배포

1. 저장소를 NAS의 `/volume1/docker/team-poll-bot` 같은 폴더에 내려받아요.
2. `cp .env.example .env`를 실행하고 투표곰의 별도 Microsoft 앱 값을 채워요. 식사 봇의 비밀값이나 앱 ID를 복사하지 않아요.

   | 변수 | 값 |
   | --- | --- |
   | `MicrosoftAppId` | 투표곰 앱 등록에서 발급된 클라이언트 ID |
   | `MicrosoftAppPassword` | 투표곰 앱 클라이언트 비밀값 |
   | `MicrosoftAppTenantId` | Microsoft 365 테넌트 ID |
   | `PUBLIC_BASE_URL` | 제안 주소 `https://poll-bot.namonak.dev`, 운영 주소 기록용 |
   | `DATABASE_PATH` | 로컬 기본값 `./data/team-poll-bot.sqlite`; Compose에서는 `/data/team-poll-bot.sqlite`로 지정 |
   | `PORT` | 컨테이너 내부 `3978` |

3. DNS·HTTPS 인증서를 준비하고 프록시에서 `/api/messages`와 `/healthz`를 `127.0.0.1:3979`로 전달해요.
4. `docker compose up -d --build`를 실행해요. 구형 Synology 환경은 `docker-compose up -d --build`를 사용해요.
5. `curl https://poll-bot.namonak.dev/healthz`가 `{"ok":true}`를 반환하는지 확인해요.

외부 주소는 제안값이에요. 실제 도메인을 바꾸면 `.env`의 운영 주소, HTTPS 프록시, 봇 endpoint,
`appPackage/manifest.json`의 `validDomains`도 함께 맞춰줘요.
인증 설정이 빠지면 서버 시작을 거부해요. `.env`와 SQLite 파일은 Git에 넣지 않아요.

Nginx 프록시 예시는 아래와 같아요.

```nginx
location / {
  proxy_pass http://127.0.0.1:3979;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

식사 봇은 호스트 포트 3978, 투표곰은 3979를 사용하므로 함께 실행할 수 있어요.
투표곰 DB는 `poll-data` 볼륨에 보관해 컨테이너 교체·재시작 후에도 선택을 유지해요.
단일 프로세스로 실행하며 같은 DB에 투표곰 컨테이너 여러 개를 연결하지 않아요.

systemd로 자동 실행하려면 `deploy/team-poll-bot.service`의 `WorkingDirectory`와 Docker 실행 경로를 서버에 맞게 바꿔줘요.

```bash
sudo cp deploy/team-poll-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now team-poll-bot
sudo systemctl status team-poll-bot
```

NAS의 Compose 명령이 `docker-compose`라면 서비스의 `ExecStart`·`ExecStop`도 맞춰줘요.

## Teams 등록

Teams Developer Portal과 Azure Bot 등록에서 투표곰 앱을 준비하고 Teams 채널을 연결해요.
봇 메시징 endpoint는 `https://poll-bot.namonak.dev/api/messages`예요.
앱 등록의 ID·비밀값·테넌트는 서버 `.env` 값과 같아야 해요.

프로젝트 최상단에서 패키지를 만들어요. `bash`, `zip`, `unzip`을 사용할 수 있는 환경이 필요해요.

```bash
cd /volume1/docker/team-poll-bot
git pull origin main
bash scripts/package-teams-app.sh
```

`.env`의 `MicrosoftAppId` 또는 같은 이름의 환경 변수로 manifest를 채워요. 앱 ID는 UUID 형식이어야 해요.
결과는 한국 시간 기준 `dist/team-poll-bot-YYYYMMDD-HHMMSS.zip`이에요.
ZIP에는 `manifest.json`, `color.png`, `outline.png`만 들어가며 비밀값은 포함되지 않아요.

생성한 ZIP을 Teams에 사용자 지정 앱으로 업로드하고 대상 단체 대화방에 추가해요.
조직에서 사용자 지정 앱 업로드를 허용해야 해요. 앱 이름·명령·아이콘을 바꾸면 새 ZIP으로 앱을 업데이트해줘요.
앱 설치 후 `@투표곰`을 실제 멘션으로 선택하고 전송하면 도움말을 펼쳐요.

컬러 아이콘은 제공된 곰을 참고해 ImageGen으로 제작했어요.
프롬프트는 ‘오른쪽 작은 곰의 윙크·파란 후드·체크 투표판을 유지하고, 파란 정사각형 배경의 Teams 아이콘으로 제작’이었어요.
외곽선 아이콘은 작은 크기의 식별성을 위해 흰색 곰 얼굴·체크를 단순한 도형으로 그렸어요.
완성 파일은 `appPackage/color.png` 192×192, `appPackage/outline.png` 32×32이며 원본은 요청대로 삭제했어요.

## 운영과 복구

### 결과판 갱신이 늦을 때

`docker compose logs --tail=100 bot`으로 로그를 확인해요.
`투표 카드 갱신 재시도`는 응답이 저장됐지만 Teams 카드 갱신이 실패했다는 뜻이에요.
30초마다 다시 시도하고, 재시작 후에도 아직 반영하지 못한 버전을 이어서 처리해요.

### 투표 게시 여부가 불확실할 때

네트워크 응답을 잃거나 게시 직후 프로세스가 종료되면 중복 결과판을 막기 위해 자동 재게시하지 않아요.
사용자에게 안내한 투표 ID와 로그의 `투표 게시 확인 필요`를 확인해요.
HTTP 400·401·403·404·413·422처럼 명확한 게시 거절이면 원인을 해결한 뒤 원래 폼을 다시 제출할 수 있어요.

그 밖의 불확실한 경우에는 먼저 봇을 멈추고 실제 대화방 게시 여부를 확인해요.
게시가 확인됐다면 해당 메시지 ID를 연결해 복구할 수 있어요. 아래 두 인수를 실제 값으로 바꿔줘요.
메시지 ID는 Teams의 ‘링크 복사’ URL에서 `/l/message/대화방/메시지ID` 부분을 확인하거나 운영 도구에서 조회해요.

```bash
docker compose stop bot
docker compose run --rm --no-deps bot node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.DATABASE_PATH);
const [pollId, messageId] = process.argv.slice(1);
if (!pollId || !messageId) throw new Error("투표 ID와 메시지 ID가 필요해요");
const result = db.prepare("UPDATE poll SET message_id=?, status=\u0027open\u0027, published_revision=0 WHERE id=? AND status=\u0027publishing\u0027").run(messageId, pollId);
if (result.changes !== 1) throw new Error("복구할 준비 중 투표를 찾지 못했어요");
db.close();
' '투표 ID' 'Teams 메시지 ID'
docker compose start bot
```

게시가 없음을 확실히 확인했다면, 같은 방식으로 `publish_state`를 `ready`로 되돌리고 폼을 다시 제출해요.
확인 없이 게시 상태를 되돌리지 않아요. 오래된 폼은 새 투표로 다시 준비해줘요.

### 백업

봇을 멈춘 뒤 `/data/team-poll-bot.sqlite`를 복사하고 다시 시작해요.

```bash
mkdir -p backups
docker compose stop bot
docker cp team-poll-bot:/data/team-poll-bot.sqlite "backups/team-poll-bot-$(date +%Y%m%d-%H%M%S).sqlite"
docker compose start bot
```

복원은 봇을 멈추고 기존 DB를 별도로 보관한 뒤 진행해요. `docker compose down -v`는 응답 볼륨을 삭제하므로 사용하지 않아요.
DB에는 투표와 이름이 있으니 백업 접근 권한도 관리해줘요.

## 로컬 개발과 확인 목록

Node 24 이상이 필요해요.

```bash
npm ci
npm test
npm run typecheck
npm run build
cp .env.example .env
# .env에 투표곰 앱 값을 채운 뒤
node --env-file=.env --import tsx src/index.ts
```

Docker는 `.env`를 자동으로 주입하지만 `npm start`는 셸에 이미 설정된 환경 변수를 사용해요.
빌드 결과만 실행하려면 `node --env-file=.env dist/index.js`를 사용해요.

실제 Teams에서는 아래 흐름을 두 계정으로 확인해줘요.

1. HTTPS 헬스 체크가 성공하고 앱을 단체 대화방에 설치해요.
2. `@투표곰`의 명령 제안과 전송 후 도움말을 확인해요.
3. 제목 사전 입력과 일괄 입력으로 폼을 열고, 다른 사용자의 시작 요청이 거부되는지 확인해요.
4. 단일·복수 투표에서 선택, 응답 변경, 집계·이름·링크를 확인해요.
5. 다른 사용자의 수동 마감이 거부되고 작성자 마감·자동 마감 후에는 응답이 거부되는지 확인해요.
6. 데스크톱·모바일의 줄바꿈과 카드 갱신을 확인하고, 서버 재시작 후에도 결과가 남는지 확인해요.

자동 테스트와 로컬/Docker 검증은 실제 Teams 테넌트의 설치·렌더링·DNS·인증서 검증을 대신하지 않아요.
