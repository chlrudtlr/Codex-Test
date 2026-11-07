# Pretendard Variable 동봉 안내

[서비스 소개](../../README.md) · [사용법의 글꼴 설명](../../docs/사용법.md#테마와-글꼴)

Daynote는 PC에 별도로 글꼴을 설치하지 않아도 같은 화면을 사용할 수 있도록 Pretendard Variable을 앱에 포함합니다. 인터넷에서 실행할 때마다 내려받지 않고 로컬 파일을 사용합니다.

## 출처와 파일

| 항목 | 내용 |
|---|---|
| 원저작자 | Kil Hyung-jin / orioncactus |
| 글꼴 배포 버전 | Pretendard 1.3.9 |
| 공식 프로젝트 | [orioncactus/pretendard](https://github.com/orioncactus/pretendard) |
| 원본 패키지 | [pretendard 1.3.9](https://www.npmjs.com/package/pretendard/v/1.3.9) |
| 패키지 안의 원본 경로 | `dist/web/variable/woff2/PretendardVariable.woff2` |
| 앱에 포함한 파일 | [PretendardVariable.woff2](PretendardVariable.woff2), 원본을 수정하지 않고 동봉 |
| 라이선스 | SIL Open Font License 1.1, [전문](OFL.txt) 동봉 |

## 앱에서의 사용

앱 내부에서는 글꼴 이름 `Pretendard Variable`과 굵기 `500`을 지정해 **Medium**으로 표시합니다. 적용은 `src/styles.css`의 `@font-face`와 공통 글꼴 스타일에서 관리합니다.

운영체제가 그리는 창 제목 표시줄과 설치 마법사는 OS 글꼴을 사용합니다. Excel 내보내기 파일의 글꼴은 `electron/export-excel.js`의 문서 스타일로 별도 지정되어 있습니다.

글꼴 파일을 배포할 때는 원저작권 표시와 라이선스 전문을 함께 보관합니다. 글꼴 버전을 교체할 경우 출처·버전·라이선스와 이 문서를 함께 확인하세요.
