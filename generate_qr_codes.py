from pathlib import Path

import qrcode
import qrcode.image.svg


BASE_URL = "https://museum-graph-match.noon-okt-s.chatgpt.site"
GRAPHS = {
    "deaths": "死亡者総数",
    "students": "在籍児童数",
    "prisoners": "在監人員",
    "cattle": "牛頭数",
    "squid": "イカ漁獲量",
}


def main() -> None:
    output = Path(__file__).with_name("qr-codes")
    output.mkdir(exist_ok=True)
    lines = ["# 展示用QRコード", ""]
    for key, label in GRAPHS.items():
        url = f"{BASE_URL}/?graph={key}"
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=16, border=4)
        qr.add_data(url)
        qr.make(fit=True)
        qr.make_image(fill_color="black", back_color="white").save(output / f"{key}.png")
        qr.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(output / f"{key}.svg")
        lines.append(f"- {label}: {url}")
    (output / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
