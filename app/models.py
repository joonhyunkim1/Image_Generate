"""지원 모델 레지스트리. 모델 추가/수정은 이 파일에서 한다."""

OPENAI_Q_25 = ["low", "medium", "high", "xhigh", "max"]
OPENAI_Q_2 = ["low", "medium", "high"]

MODELS: list[dict] = [
    {
        "id": "gpt-image-2.5-sunburst", "label": "GPT Image 2.5 Sunburst", "provider": "openai", "api_model": "gpt-image-2.5-sunburst",
        "qualities": OPENAI_Q_25, "default_quality": "high", "transparent": True,
        "edit": True, "mask": True, "max_n": 10, "max_refs": 16, "sizing": "openai",
        "tagline": "정밀도 중심 최상위 GPT 이미지 모델",
        "pros": ["지시 이행·정확한 글자(텍스트) 표현", "투명 배경 PNG 지원", "마스크 부분 수정(인페인팅)"],
        "cons": ["고품질(xhigh/max)은 장당 비용이 큼", "Flare보다 느릴 수 있음"],
    },
    {
        "id": "gpt-image-2.5-flare", "label": "GPT Image 2.5 Flare", "provider": "openai", "api_model": "gpt-image-2.5-flare",
        "qualities": OPENAI_Q_25, "default_quality": "medium", "transparent": True,
        "edit": True, "mask": True, "max_n": 10, "max_refs": 16, "sizing": "openai",
        "tagline": "속도 중심, 대량·반복 생성에 적합",
        "pros": ["빠른 생성 속도", "Sunburst와 같은 단가 체계", "투명 배경 PNG·마스크 수정 지원"],
        "cons": ["복잡한 지시·세밀한 디테일은 Sunburst가 유리할 수 있음"],
    },
    {
        "id": "gpt-image-2", "label": "GPT Image 2", "provider": "openai", "api_model": "gpt-image-2",
        "qualities": OPENAI_Q_2, "default_quality": "medium", "transparent": False,
        "edit": True, "mask": True, "max_n": 10, "max_refs": 16, "sizing": "openai",
        "tagline": "이전 세대 GPT 이미지 모델",
        "pros": ["유연한 해상도 지정", "마스크 부분 수정 지원", "low 품질은 매우 저렴"],
        "cons": ["투명 배경 미지원(API가 거부함)", "medium/high 단가가 2.5 시리즈보다 높게 알려져 있음"],
    },
    {
        "id": "nano-banana-2", "label": "Nano Banana 2", "provider": "gemini", "api_model": "gemini-3.1-flash-image",
        "qualities": [], "default_quality": "", "transparent": False,
        "edit": True, "mask": False, "max_n": 4, "max_refs": 10, "sizing": "gemini",
        "tagline": "Google Gemini 기반, 빠르고 저렴한 4K 지원 모델",
        "pros": ["장당 가격이 낮고 빠름", "최대 4K, 다양한 종횡비", "참조 이미지 최대 10장 / 대화형 편집"],
        "cons": ["투명 배경 미지원", "마스크 대신 프롬프트로 수정"],
    },
    {
        "id": "flux-2-max", "label": "FLUX.2 Max", "provider": "bfl", "api_model": "flux-2-max",
        "qualities": [], "default_quality": "", "transparent": False,
        "edit": True, "mask": False, "max_n": 4, "max_refs": 8, "sizing": "bfl",
        "tagline": "FLUX.2 중 최고 품질, 편집 일관성 최강",
        "pros": ["가장 높은 품질과 프롬프트 충실도", "강한 편집 일관성", "참조 이미지 최대 8장"],
        "cons": ["FLUX.2 중 가장 비쌈", "투명 배경 미지원"],
    },
    {
        "id": "flux-2-pro", "label": "FLUX.2 Pro", "provider": "bfl", "api_model": "flux-2-pro",
        "qualities": [], "default_quality": "", "transparent": False,
        "edit": True, "mask": False, "max_n": 4, "max_refs": 8, "sizing": "bfl",
        "tagline": "품질·속도·가격 균형, FLUX.2 기본 추천",
        "pros": ["합리적인 가격(첫 1MP 약 $0.03)", "생성·편집 모두 안정적", "참조 이미지 최대 8장"],
        "cons": ["Max보다 디테일·일관성은 낮을 수 있음", "투명 배경 미지원"],
    },
    {
        "id": "flux-2-flex", "label": "FLUX.2 Flex", "provider": "bfl", "api_model": "flux-2-flex",
        "qualities": [], "default_quality": "", "transparent": False,
        "edit": True, "mask": False, "max_n": 4, "max_refs": 8, "sizing": "bfl",
        "tagline": "타이포그래피와 작은 디테일 보존에 특화",
        "pros": ["글자(타이포) 표현과 미세 디테일에 강함", "참조 이미지 최대 8장"],
        "cons": ["메가픽셀 단가가 일정($0.06/MP)해 큰 이미지는 비쌈", "투명 배경 미지원"],
    },
]

BY_ID = {m["id"]: m for m in MODELS}

PROVIDERS = {
    "openai": {"label": "OpenAI", "env": "OPENAI_API_KEY"},
    "gemini": {"label": "Google (Gemini)", "env": "GEMINI_API_KEY"},
    "bfl": {"label": "Black Forest Labs", "env": "BFL_API_KEY"},
}


def get(model_id: str) -> dict:
    if model_id not in BY_ID:
        raise KeyError(f"알 수 없는 모델입니다: {model_id}")
    return BY_ID[model_id]
