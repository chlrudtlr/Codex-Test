"""Render the application's own vector-style calendar mark into desktop icons."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / "assets"
scale = 4
image = Image.new("RGBA", (256 * scale, 256 * scale))
draw = ImageDraw.Draw(image)

def box(values):
    return tuple(int(value * scale) for value in values)

draw.rounded_rectangle(box((8, 8, 248, 248)), radius=66 * scale, fill="#496650")
draw.rounded_rectangle(box((58, 68, 198, 204)), radius=27 * scale, outline="white", width=12 * scale)
for coordinates in [((89, 49), (89, 86)), ((167, 49), (167, 86)), ((59, 111), (197, 111))]:
    draw.line([box(point) for point in coordinates], fill="white", width=12 * scale)
    for x, y in coordinates:
        draw.ellipse(box((x - 6, y - 6, x + 6, y + 6)), fill="white")
draw.line([box(point) for point in [(94, 154), (117, 177), (161, 133)]], fill="white", width=12 * scale, joint="curve")
for x, y in [(94, 154), (117, 177), (161, 133)]:
    draw.ellipse(box((x - 6, y - 6, x + 6, y + 6)), fill="white")
image = image.resize((256, 256), Image.Resampling.LANCZOS)
image.save(root / "icon.png")
image.save(root / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("assets/icon.png, assets/icon.ico 생성 완료")
