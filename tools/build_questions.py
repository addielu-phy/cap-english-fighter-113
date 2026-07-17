from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAM_PATH = ROOT / "data" / "exam113.json"
META_PATH = ROOT / "data" / "meta113.json"


def main() -> None:
    exam = json.loads(EXAM_PATH.read_text(encoding="utf-8"))
    meta_rows = json.loads(META_PATH.read_text(encoding="utf-8"))
    questions_raw = exam["questions"]

    assert exam["id"] == "113-english-reading"
    assert len(questions_raw) == 43
    assert [int(item["number"]) for item in questions_raw] == list(range(1, 44))
    assert len(meta_rows) == 43
    assert [item["number"] for item in meta_rows] == list(range(1, 44))

    meta = {item["number"]: item for item in meta_rows}
    questions = []
    for raw in questions_raw:
        number = int(raw["number"])
        detail = meta[number]
        for field in ("unit", "difficulty", "explanation", "trap"):
            assert isinstance(detail[field], str) and detail[field].strip(), f"q{number} {field}"
        assert len(detail["explanation"]) >= 35, f"q{number} explanation"
        assert len(detail["trap"]) >= 20, f"q{number} trap"
        assert raw["answer"] in range(4), f"q{number} answer"

        def remap(value: str) -> str:
            return "assets/questions/" + Path(value).name

        questions.append({
            "id": f"113-eng-q{number:02d}",
            "number": number,
            "unit": detail["unit"],
            "difficulty": detail["difficulty"],
            "answer": raw["answer"],
            "images": [remap(value) for value in raw["images"]],
            "contextImages": [remap(value) for value in raw.get("contextImages", [])],
            "explanation": detail["explanation"],
            "trap": detail["trap"],
        })

    referenced = {value for q in questions for value in q["images"] + q["contextImages"]}
    actual = {"assets/questions/" + p.name for p in (ROOT / "assets" / "questions").glob("*.webp")}
    assert referenced == actual, {"missing": sorted(referenced - actual), "extra": sorted(actual - referenced)}

    output = "window.ENGLISH_QUESTIONS = " + json.dumps(questions, ensure_ascii=False, indent=2) + ";\n"
    (ROOT / "questions.js").write_text(output, encoding="utf-8")
    print(json.dumps({
        "questions": len(questions),
        "questionImages": sum(len(q["images"]) for q in questions),
        "contextAssets": len({x for q in questions for x in q["contextImages"]}),
        "assets": len(actual),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
