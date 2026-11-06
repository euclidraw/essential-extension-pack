# alid extension template

`owner/repo`로 설치할 수 있는 alid 확장 저장소 템플릿입니다. 예제 **스티키 노트**는 캔버스 도구 선반에 추가 버튼을 제공하고, 노트의 제목·메모·배경색을 속성 패널에서 편집합니다. 생성과 속성 편집은 호스트의 Undo 타임라인을 사용합니다.

## 바로 설치하기

alid의 **확장 관리 → GitHub에서 설치**에 `jiwonme/alid-extension-template`을 입력하세요. 저장소와 버전을 확인하고 신뢰를 승인한 뒤 설치합니다. 캔버스 왼쪽 도구 선반의 **스티키 노트 추가** 또는 명령 팔레트의 같은 명령으로 노트를 만듭니다.

**설치 API 2**를 지원하는 alid가 필요합니다. `engine: "^0.1.0"`은 커널의 호환 버전 범위입니다. 커널 버전과 설치 API 버전은 별개이므로 `apiVersion: 2` 지원도 확인해야 합니다. 이전 API 1 매니페스트와 캐시는 실행 전에 거부하며 자동 변환하지 않습니다. 기존 확장은 새 형식으로 다시 빌드하고 저장소에서 다시 설치하세요.

이 예제는 앱 안에서 실행되는 신뢰 확장입니다. `capabilities`는 접근 의도를 설명하고, `dependencies`·`optionalDependencies`·`provides`는 서비스와 공개 API의 의존성 검증에 사용합니다. 이 검증은 DOM·네트워크 등 신뢰 코드 전체를 격리하는 샌드박스가 아닙니다. 조회만 할 때는 플러그인을 실행하지 않으며, 설치를 승인한 소스와 커밋을 로컬에 보관합니다. 업데이트하려면 저장소를 다시 조회하고 새 코드를 승인해야 합니다. 설치·제거 자체는 문서 객체를 만들거나 지우지 않습니다.

## 내 확장 만들기

1. 이 저장소에서 **Use this template → Create a new repository**를 선택하고 **공개 저장소**를 만듭니다.
2. 새 저장소를 clone하고 `extension.json`의 `id`, `title`, `version`, `summary`와 필요한 의존성 선언을 수정합니다. `id`에는 `yourname.reading-notes`처럼 고유한 네임스페이스를 사용하세요. 예제의 어스펙트와 명령 ID는 이 값에서 생성됩니다.
3. Node.js 22.12 이상과 pnpm 11.22.0을 준비합니다.

```sh
pnpm install --frozen-lockfile
pnpm test
```

4. `pnpm dev`로 개발 서버를 켜고 alid에 연결한 뒤 `src/index.js`를 수정합니다. 저장할 때마다 캔버스에 바로 반영됩니다([아래](#watch-모드로-개발하기)). 마무리 전에 `pnpm test`를 실행합니다.
5. 소스와 함께 **`dist/plugin.js`, `alid.extension.json`**을 커밋하고 기본 브랜치에 푸시합니다. `pnpm-lock.yaml`도 커밋해야 합니다.
6. alid에서 새 `owner/repo`를 입력해 설치합니다. 별도의 웹 호스팅이나 npm 배포는 필요하지 않습니다.

예제의 공개 설치본과 새 저장소를 동시에 설치하려면 먼저 `id`를 바꾸세요. 기존 사용자에게 업데이트할 때는 `id`와 어스펙트 ID를 유지하고 `version`을 올립니다. 파괴적인 스키마 변경은 새 어스펙트 ID를 사용해야 합니다.

## watch 모드로 개발하기

```sh
pnpm dev               # http://127.0.0.1:5174
pnpm test:watch        # 다른 터미널에서 계약 테스트를 저장할 때마다 실행
```

1. `pnpm dev`가 표시한 주소를 alid의 **확장 관리 → 개발 중인 확장 연결**에 입력하고, 실행을 허용한 뒤 **연결**을 누릅니다.
2. `src/`를 저장하면 다시 빌드되고, alid가 새 코드를 받아 그 자리에서 교체합니다. 캔버스의 노트와 Undo 기록은 그대로 남습니다. 확장 목록에는 `개발` 표시와 빌드 번호(#2, #3…)가 나타납니다.
3. 빌드에 실패하면 오류가 연결 카드에 표시되고, **마지막으로 성공한 빌드가 계속 실행**됩니다. 고치고 저장하면 다시 반영됩니다.
4. 끝나면 **연결 끊기**를 누르거나 새로고침합니다. 개발 코드는 저장되지 않으며, 다음에 열 때 마지막 주소만 미리 채워집니다.

개발 서버는 GitHub 설치와 같은 매니페스트·SHA256·패키지 계약 검증을 거칩니다. 그래서 개발 중에 동작하면 배포 후에도 같은 경로로 설치됩니다. 개발 빌드는 무시되는 `.alid-dev/`에 만들어지므로 커밋할 `dist/plugin.js`와 `alid.extension.json`은 `pnpm build` 전까지 바뀌지 않습니다.

- **연결 규칙:** 이 컴퓨터의 주소(`localhost`, `127.0.0.1`)만 연결할 수 있습니다. 개발 서버는 `127.0.0.1`에서만 열리고, alid 기본 주소(`http://127.0.0.1:5173`, `http://localhost:5173`)의 요청만 받습니다. 다른 주소의 alid를 쓰면 `pnpm dev --origin https://alid.example`로 추가하세요. 포트는 `--port`로 바꿉니다.
- **ID 고정:** 개발 중에는 확장 ID를 바꿀 수 없습니다. ID를 바꿨다면 연결을 끊고 다시 연결하세요. 같은 ID의 확장이 GitHub에서 이미 설치되어 있으면 먼저 제거해야 합니다.
- **교체 범위:** 다시 불러올 때 `activate`가 반환한 정리 함수가 먼저 호출됩니다. 명령·구독·타이머를 그 안에서 정리하지 않으면 교체할 때마다 중복됩니다.
- **스키마 변경:** 이미 만든 객체의 어스펙트 ID와 속성 이름은 유지하세요. 기본값(`defaults`)과 렌더링은 자유롭게 바꿔도 됩니다.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `extension.json` | 이름·ID·버전·호환 범위와 확장 의존성 |
| `src/manifest.js` | 번들과 설치 명세가 함께 사용하는 패키지 계약 |
| `src/index.js` | 공개 `ExtensionPackageSpec` 구조를 따르는 예제 |
| `vite.config.js` | 단일 ESM 번들 생성과 호스트 공유 모듈 외부화 |
| `scripts/build.mjs` | 빌드와 설치 manifest·SHA256 생성 |
| `scripts/dev.mjs` | watch 빌드와 alid 연결용 로컬 개발 서버(`pnpm dev`) |
| `scripts/install-manifest.mjs` | build와 dev가 함께 쓰는 설치 manifest 생성 |
| `dist/plugin.js` | 브라우저가 설치하는 코드, Git에 포함 |
| `alid.extension.json` | 설치 명세, Git에 포함 |
| `test/plugin.test.mjs` | 무결성·생성·해제·순수 파생·출판 검증 |
| `test/dev-server.test.mjs` | 변경 시 재빌드·해시 일치·reload 이벤트·출처 제한 검증 |
| `.github/workflows/check.yml` | 테스트 및 커밋된 산출물 최신 여부 확인 |

## 설치 명세

호스트는 공개 GitHub 저장소의 기본 브랜치를 커밋 SHA로 고정한 뒤, 같은 커밋에서 `alid.extension.json`과 번들을 읽습니다. `apiVersion`은 `2`입니다. `engine`, 두 의존성 맵, `conflicts`, `provides`의 세 배열은 빈 값이라도 명시해야 합니다.

```json
{
  "apiVersion": 2,
  "id": "yourname.reading-notes",
  "title": "Reading notes",
  "version": "0.3.0",
  "engine": "^0.1.0",
  "dependencies": {},
  "optionalDependencies": {},
  "conflicts": [],
  "provides": {
    "services": [],
    "aspects": ["yourname.reading-notes.note"],
    "hsmSlots": []
  },
  "summary": "독서 메모를 추가합니다.",
  "entry": "dist/plugin.js",
  "sha256": "빌드 시 생성되는 64자리 SHA256",
  "aspectIds": ["yourname.reading-notes.note"],
  "capabilities": {
    "readAspects": ["yourname.reading-notes.note", "core.transform", "core.bounds"],
    "writeAspects": ["yourname.reading-notes.note", "core.transform", "core.bounds"],
    "services": ["canvas.creation"],
    "commands": ["yourname.reading-notes:add-note"]
  }
}
```

`src/manifest.js`가 `extension.json`에서 패키지 계약과 예제 어스펙트 ID를 만들고, `src/index.js`와 `scripts/build.mjs`가 이를 함께 사용합니다. 번들의 `version`, `engine`, `dependencies`, `optionalDependencies`, `conflicts`, `provides`는 설치 명세와 일치해야 합니다. 기능을 추가하면 이 공통 계약과 접근 의도 메타데이터도 함께 바꾸세요. 생성된 SHA256을 직접 수정하거나 산출물 대신 TypeScript 원문 경로를 지정하지 마세요. 개인 저장소, 액세스 토큰, npm 의존성의 런타임 설치는 이 방식에서 지원하지 않습니다.

## 의존성 선언

`extension.json`의 `dependencies`와 `optionalDependencies`에는 npm 패키지명이 아닌 **alid 논리 확장 ID와 버전 범위**를 적습니다. 기본 스티키 노트는 다른 확장 없이 호스트의 `canvas.creation`만 사용하므로 두 목록이 비어 있습니다.

- 필수 의존성은 먼저 활성화됩니다. 필수 공급자를 끄면 소비자도 함께 해제해야 하며, 확장 관리에서 영향 목록을 확인할 수 있습니다.
- 선택 의존성은 설치되어 있고 버전이 맞으며 꺼져 있지 않을 때 활성화 순서에 참여합니다. 없어도 소비자가 동작해야 하며, 공급자를 끄면 소비자는 유지됩니다.
- 확장 ID마다 한 버전만 설치합니다. 요구 범위가 충돌하면 중복 버전을 적재하지 않고 오류를 보고합니다. 의존성 선언 자체가 다른 GitHub 저장소나 npm 패키지를 다운로드하지는 않습니다. 필요한 공급자 확장은 따로 설치하세요.
- 버전은 `MAJOR.MINOR.PATCH` 정식 릴리스이며, 범위는 정확한 버전·`^`·`~`·비교 연산자·와일드카드·공백 AND·`||` OR를 지원합니다. `^0.1.0`은 `0.1.x`, `^0.0.1`은 `0.0.1`만 허용합니다. 프리릴리스·빌드 접미사·하이픈 범위·`^1.2` 같은 축약 버전은 지원하지 않습니다.

직접 선언한 확장의 API만 `context.getExtensionApi(id)` 또는 `requireExtensionApi(id)`로 조회할 수 있습니다. 예제는 `{ addNote }` API를 반환하며, 조회만으로 노트를 만들지는 않습니다. 다른 확장이 명시적으로 `addNote()`를 호출할 때 생성합니다. 서비스·선택적 연동과 정리 예제는 [확장 API 안내](docs/api.md#의존성-api와-서비스)에 있습니다.

## 공개 API 사용 원칙

- `default` export는 `ExtensionPackageSpec` 형태의 객체입니다. `activate(context)`는 정리 함수 또는 `{ api, dispose }`를 반환합니다. 이 예제는 생성 API와 명령 해제 함수를 함께 반환합니다.
- `canvas.creation` 서비스가 객체의 내용·위치·크기를 한 배치와 한 Undo 단위로 만듭니다. 확장은 `core.transform`과 `core.bounds`를 중복 작성하지 않습니다.
- 저장할 내용은 `defaults`와 정본 어스펙트로, 좌표·출판 기하는 순수 `derive()` 결과로 분리합니다. 화면 조회나 설치 중 정본을 수정하지 않습니다.
- `ui.controls`의 `tool-shelf` action으로 생성 도구를 기여합니다. 호스트의 툴바를 직접 수정하지 않습니다.
- DOM 콘텐츠와 화면 밖 SVG 출판을 함께 제공합니다. 외곽 위치·회전·카메라는 호스트가 관리합니다.
- `@alid/kernel`과 `@alid/react`는 호스트가 import map으로 제공하며, 이 템플릿에서 npm SDK를 설치할 필요가 없습니다. 현재 스티키 노트는 공개 구조 계약만 쓰므로 SDK import가 없습니다.
- Vite 설정은 `@alid/kernel`, `@alid/react`, `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, `react-dom/client`를 외부 모듈로 남깁니다. 브라우저에서 호스트와 같은 인스턴스를 사용합니다. 다른 라이브러리는 번들에 포함하세요.
- 설치 코드는 Blob URL에서 실행됩니다. 허용된 공유 모듈 외에 상대 경로 청크·CSS·에셋 import를 남기면 안 됩니다. 이 빌드는 단일 파일과 공유 import 목록을 검사합니다. 공유 SDK를 import한 번들을 Node에서 직접 실행하려면 테스트용 대역이나 모듈 해석 설정도 필요합니다.
- React 확장으로 바꿀 때는 호스트의 공유 모듈과 `@alid/react`를 사용하고 중복 React 루트를 만들지 마세요. 현재 예제는 React를 사용하지 않습니다.

예제 작성에 필요한 구조 계약과 호스트 서비스는 이 저장소의 [확장 API 안내](docs/api.md)에 정리했습니다. alid 원본 저장소에 접근하지 않아도 이 템플릿을 수정하고 빌드할 수 있습니다. 빌드는 [Vite library mode](https://vite.dev/guide/build.html#library-mode)를 사용합니다.

## 검증 범위

`pnpm test`는 실제 번들을 import해 manifest 해시와 패키지 계약의 일치·명시적 생성 API·정리 함수·정본 읽기 전용 파생·출력 이스케이프·선언형 속성을 확인합니다. CI는 재빌드 후 산출물의 Git diff가 없는지 확인합니다. 브라우저에서 설치·선택·이동·리사이즈·속성 편집·Undo·SVG 내보내기를 추가로 확인하세요. 이 템플릿은 1,000개 객체의 120fps나 0-GC 달성을 주장하지 않습니다.

MIT License.
