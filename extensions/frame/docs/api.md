# 예제에서 사용하는 확장 API

이 문서는 이 템플릿이 사용하는 구조 계약의 안내입니다. npm SDK나 전체 호스트 API 선언은 아닙니다. 별도 패키지를 import하지 않고 아래 형태의 JavaScript 객체를 반환하면 됩니다. `src/index.js`가 실행 가능한 예제입니다.

## 설치 단위

번들의 기본 export는 다음 형태입니다.

```js
export default {
  id: 'yourname.reading-notes',
  version: '0.3.0',
  engine: '^0.1.0',
  dependencies: {},
  optionalDependencies: {},
  conflicts: [],
  provides: { aspects: ['yourname.reading-notes.note'], services: [], hsmSlots: [] },
  summary: '독서 메모를 추가합니다.',
  aspects: [noteAspect],
  ui: { controls: [createButton] },
  activate(context) {
    // 명령·이벤트·서비스 등을 등록하고 정리 함수를 반환합니다.
    return () => {};
  },
};
```

`ExtensionPackageSpec`의 `id`, `version`, `summary`는 필수입니다. `aspects`, `ui`, `activate`는 기능에 따라 생략할 수 있습니다. 설치 명세는 `apiVersion: 2`를 사용하며, `engine`, `dependencies`, `optionalDependencies`, `conflicts`, `provides.services`·`aspects`·`hsmSlots`를 빈 값이라도 명시해야 합니다. 설치 단위의 ID와 버전·의존성·공개 계약은 `alid.extension.json`과 일치해야 합니다. 템플릿의 `src/manifest.js`를 런타임 코드와 빌드 스크립트가 함께 사용하므로 생성 파일에 같은 값을 따로 적지 않습니다. 등록·활성화 도중 문서 객체를 자동 생성하지 마세요. 사용자의 명시적인 명령이 문서를 변경하게 만드세요.

`activate`는 `undefined`, 정리 함수, 또는 `{ api, dispose }`를 반환합니다. `dispose`는 비활성화·일시정지·다시 불러오기·제거 시 호출됩니다. 등록한 명령, 이벤트 리스너, 타이머와 구독을 여기에서 정리하세요. 여러 자원을 만들었다면 생성의 역순으로 정리합니다. 다시 활성화될 수 있으므로 이전 활성화에서 폐기한 자원을 재사용하지 마세요.

스티키 노트는 `{ api: { addNote }, dispose }`를 반환합니다. `addNote()`는 사용자의 명시적인 명령에서 호출할 때 새 노트를 만들고 엔티티 ID를 반환합니다. 활성화나 API 조회만으로 문서가 바뀌지는 않습니다.

## 의존성 API와 서비스

`dependencies`는 필요한 공급자를 먼저 켜며, `optionalDependencies`는 호환되는 공급자가 설치되어 있고 꺼져 있지 않을 때만 설치 순서에 참여합니다. 공급자가 없는 선택 연동에는 대체 동작이 필요합니다. 하나의 논리 ID에 서로 다른 버전을 동시에 적재하지 않습니다. 이 선언은 설치된 확장 사이의 런타임 계약으로, GitHub·npm 다운로드 요청이 아닙니다.

`context.getExtensionApi(id)`는 직접 선언한 공급자의 활성 API를 반환하며, 선택 공급자가 없거나 꺼져 있거나 버전이 맞지 않으면 `undefined`입니다. `requireExtensionApi(id)`는 사용할 API가 없으면 오류를 던집니다. 선언하지 않은 ID를 조회하면 오류가 납니다. 의존성의 의존성을 간접적으로 열어 주지 않습니다.

다음은 스티키 노트를 사용하는 **별도 확장**의 예입니다. 그 확장의 설치 매니페스트에도 같은 의존성을 선언해야 합니다. 선택 API는 명령을 실행할 때 조회하므로 공급자가 다시 불러와진 뒤에도 이전 객체를 계속 사용하지 않습니다.

```js
export default {
  id: 'yourname.note-shortcuts',
  version: '0.1.0',
  engine: '^0.1.0',
  summary: '필요할 때 스티키 노트를 추가합니다.',
  dependencies: { 'yourname.reading-notes': '^0.3.0' },
  optionalDependencies: { 'sys.minibuffer': '^0.1.0' },
  conflicts: [],
  provides: { services: [], aspects: [], hsmSlots: [] },
  activate(context) {
    const abort = new AbortController();
    const off = context.commands.register({
      id: 'yourname.note-shortcuts:add',
      title: '노트 추가',
      summary: '미니버퍼가 있으면 확인한 뒤 노트를 추가합니다.',
      async run() {
        const minibuffer = context.getExtensionApi('sys.minibuffer');
        if (minibuffer) {
          const accepted = await minibuffer.completingRead({
            prompt: '노트를 추가할까요?',
            candidates: [{ id: 'add', label: '새 노트 추가', value: true }],
            signal: abort.signal,
          });
          if (!accepted) return; // 취소 또는 공급자 해제
        }
        if (abort.signal.aborted) return;
        return context.requireExtensionApi('yourname.reading-notes').addNote();
      },
    });
    return () => { abort.abort(); off(); };
  },
};
```

패키지의 `context.services`는 호스트 공용 서비스, 자기 `provides.services`, 직접 선언한 공급자가 제공하는 서비스만 조회합니다. `canvas.creation` 같은 호스트 서비스는 확장 의존성으로 적지 않습니다. 직접 서비스 제공 시에는 이름을 `provides.services`에 선언해야 합니다.

```js
// 이 확장과 설치 매니페스트에 provides.services: ['yourname.notes'] 선언
const release = context.services.provide('yourname.notes', { addNote });
return { api: { addNote }, dispose: release };
```

`api` 반환 자체에는 서비스 ID가 필요하지 않습니다. `provides.aspects`는 소유 어스펙트, `provides.hsmSlots`는 공개하는 HSM 부모 상태 경로입니다. 같은 서비스·어스펙트·슬롯을 여러 확장이 소유한다고 선언하면 등록이 거부됩니다. `capabilities.services`는 읽거나 사용하는 서비스의 설명용 목록이며 `provides.services`와 역할이 다릅니다.

필수 공급자를 해제하면 소비자부터 정리해야 하며, 다시 불러오기에서는 공급자부터 복구합니다. 선택 공급자를 해제해도 소비자는 유지되므로 선택 API를 영구 캐시하지 마세요. 사용 중인 공급자가 아예 설치되지 않았을 수도 있는 연동은 공급자의 서비스 이름을 바로 조회하기보다 `getExtensionApi()`로 가용성을 확인하세요.

범위는 정확한 정식 버전·`^`·`~`·비교 연산자·와일드카드·공백 AND·`||` OR를 지원합니다. `^0.1.0`은 `0.1.x`, `^0.0.1`은 `0.0.1`만 허용합니다. 프리릴리스·빌드 접미사·하이픈 범위·축약 숫자 버전은 지원하지 않습니다. `engine`은 `@alid/kernel`의 호환 범위이며 확장 패키지 버전과 별개입니다.

## 객체 어스펙트

어스펙트는 저장할 속성과 읽기 전용 파생·표시 동작을 정의합니다.

| 필드 | 예제에서의 의미 |
| --- | --- |
| `id` | 고유한 어스펙트 이름. 예: `yourname.reading-notes.note` |
| `label`, `summary` | 사용자에게 보이는 이름과 설명 |
| `defaults` | JSON으로 저장 가능한 속성 기본값 |
| `textFields` | 협업 텍스트로 취급하는 `defaults`의 필드 이름 |
| `textSearchFields` | 검색 대상으로 제공하는 텍스트 필드 이름 |
| `dependsOnCanonical` | 파생 계산이 읽는 정본 어스펙트 목록 |
| `dependsOnComputed` | 파생 계산이 읽는 다른 파생값 목록. 이 예제는 빈 배열 |
| `derive(props, entityId, view)` | 정본을 읽어 화면용 기하를 반환하는 순수 함수 |
| `renderDom(content, props, derived, entityId)` | 호스트가 준 콘텐츠 컨테이너에 표시 |
| `renderSvg(props, derived, entityId)` | `{ svg: 문자열 }` 반환. 그리기 순서는 호스트가 정합니다 |
| `layout` (선택) | `true`이면 `derive` 결과가 객체의 공용 레이아웃 박스가 됩니다. 자동 크기 객체용 |
| `paintBounds(derived)` (선택) | `core.bounds` 박스가 없는 객체(연결선·자유 곡선 등)가 그리는 월드 박스 `{ x, y, width, height }` |
| `ui.controls` | 이 어스펙트의 속성을 편집하는 선언형 컨트롤 |

`derive`의 `view.getCanonical(entityId, aspectId)`는 해당 객체의 저장된 어스펙트를 읽으며 없으면 `undefined`를 반환합니다. 예제는 `core.transform`의 `x`, `y`, `rotation`과 `core.bounds`의 `width`, `height`를 읽습니다. 회전 값은 라디안입니다. 높이가 없으면 예제 자체의 결정론적인 기본값을 사용합니다.

예제의 파생 객체는 `{ x, y, width, height, rotation }`입니다. 이 값은 화면과 출판을 위해 계산할 뿐 `defaults`나 문서에 다시 저장하지 않습니다. 파생 함수 안에서는 문서 쓰기, DOM 접근, 네트워크 요청을 하지 마세요.

### 그리기 순서와 화면 영역

모든 문서 객체는 하나의 z축에 쌓입니다. 순서는 정본 `core.stacking` 어스펙트의 분수 인덱스로 저장되며, 호스트가 DOM·SVG 출판·선택 판정·공간 인덱스에 같은 순위를 적용합니다. 새로 만든 객체는 맨 위에 놓이고, 사용자는 **앞으로 가져오기/뒤로 보내기** 명령으로 순서를 바꿉니다. 그래서 확장은 `zOrder`나 `layer`를 반환하거나 `core.stacking`을 직접 쓰지 않습니다. 이전 템플릿의 `layer: 'underlay' | 'overlay'`는 더 이상 쓰지 않습니다.

컬링·전체 보기·공간 인덱스에는 호스트가 계산하는 `computed.effectiveBounds`가 쓰입니다. `core.transform`·`core.bounds`가 있는 객체는 따로 할 일이 없습니다. 박스가 없는 객체는 `paintBounds(derived)`로 그리는 영역을 알려 주세요. 그래야 화면 밖에서 잘리거나 전체 보기에서 빠지지 않습니다. `@alid/kernel`을 import하는 확장은 `readLayoutBounds(view, id)`·`readEffectiveBounds(view, id)`로 다른 객체의 박스를 읽을 수 있습니다.

```js
// 박스 없는 선형 객체의 예
paintBounds: line => line && { x: Math.min(line.x1, line.x2) - 2, y: Math.min(line.y1, line.y2) - 2, width: Math.abs(line.x2 - line.x1) + 4, height: Math.abs(line.y2 - line.y1) + 4 },
```

DOM 콜백은 **안쪽 콘텐츠만** 소유합니다. 바깥 컨테이너의 좌표·회전·카메라 변환은 호스트가 처리합니다. 콘텐츠에 이벤트나 구독을 만들었다면 `renderDom`에서도 정리 함수를 반환할 수 있습니다. 시각 객체는 DOM이 없어도 내보낼 수 있도록 SVG 경로를 함께 제공하세요. SVG 문자열의 사용자 입력은 이스케이프하고 색상 등 속성값도 검증해야 합니다.

## 생성 서비스와 명령

`context.services.get('canvas.creation')`으로 생성 서비스를 얻습니다. 서비스가 없으면 이 기능을 제공하지 않는 호스트이므로 명확한 오류를 반환하세요.

```js
const creation = context.services.get('canvas.creation');
if (!creation) throw new Error('canvas.creation 서비스가 필요합니다.');

return context.commands.register({
  id: 'yourname.reading-notes:add-note',
  title: '독서 메모 추가',
  summary: '현재 화면에 메모를 추가합니다.',
  shortcutScope: 'canvas',
  run: () => creation.create({
    caller: 'yourname.reading-notes:add-note',
    aspects: { 'yourname.reading-notes.note': { title: '새 메모' } },
    width: 240,
    height: 160,
  }),
});
```

`commands.register`는 해제 함수를 반환합니다. 명령 ID는 `namespace:name` 형태이고 이름·설명·`run` 구현이 필요합니다. `keys`는 선택적인 단축키 문자열 배열입니다. 이 예제는 기존 편집 단축키와 충돌하지 않도록 키를 지정하지 않습니다.

`creation.create`는 생성된 엔티티 ID를 반환합니다. `aspects`에는 등록한 객체의 **내용**만 넣습니다. `core.transform`·`core.bounds`는 호스트가 가시 영역의 위치와 요청한 크기로 작성합니다. `width`와 `height`는 유한한 양수여야 합니다. 호스트가 생성 전체를 한 정본 배치와 한 Undo 단위로 처리합니다.

## 도구 선반과 속성

도구 선반 버튼은 설치 단위의 `ui.controls`에 아래 action을 추가합니다.

```js
{
  id: 'add-note',
  kind: 'action',
  label: '독서 메모 추가',
  icon: 'document',
  commandSymbol: 'yourname.reading-notes:add-note',
  placement: 'tool-shelf',
  requiresSelection: false,
}
```

`commandSymbol`은 등록한 명령 ID와 같아야 합니다. `requiresSelection: false`이므로 선택한 객체가 없어도 버튼이 나타납니다. `icon`은 호스트가 아는 공통 아이콘 이름이며 예제는 `document`를 사용합니다.

속성 컨트롤은 **어스펙트의** `ui.controls`에 둡니다. `field`는 그 어스펙트의 `defaults`에 존재하는 속성이어야 합니다.

```js
{ id: 'title', kind: 'text', field: 'title', label: '제목', placement: 'inspector' }
{ id: 'color', kind: 'color', field: 'color', label: '배경색', placement: 'inspector' }
```

호스트가 선택된 객체의 필드를 읽고 편집·Undo를 처리합니다. 확장 코드가 패널 DOM이나 현재 선택을 직접 조작할 필요가 없습니다.

## 신뢰와 호환성

이 설치 형식은 사용자가 승인한 뒤 앱 안에서 코드를 실행합니다. `capabilities`는 사용자에게 접근 의도를 설명합니다. 의존성과 `provides` 선언은 서비스/API 사용을 검증하지만, 신뢰 JavaScript 전체를 격리하는 보안 샌드박스는 아닙니다. 예제는 DOM 콘텐츠, 생성 서비스, 자기 명령만 사용합니다.

이 패키지 형식은 설치 API 2를 지원하는 호스트에서 사용하세요. 이전 API 1 매니페스트와 캐시는 코드 실행 전에 거부하며 자동 마이그레이션하지 않습니다. 새 형식으로 빌드하고 다시 설치해야 합니다. `engine: "^0.1.0"`은 커널 호환 범위이며 설치 API 2 지원 여부와 별개입니다. 호스트가 제공하는 `@alid/kernel`, `@alid/react`, React 공유 import 외의 라이브러리는 번들에 포함하고, Blob URL에서 해석할 수 없는 상대 경로 청크·에셋 import는 남기지 마세요.

문서에 저장되는 어스펙트 ID와 속성은 업데이트 후에도 유지하세요. 파생 기하·함수·DOM 노드·타이머·Blob URL을 문서 속성에 저장하지 마세요. 비활성화하거나 제거하더라도 저장된 객체 데이터를 지우지 않는 것이 계약입니다.
