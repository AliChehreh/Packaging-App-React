import io, base64
import barcode
from barcode.writer import ImageWriter

def generate_barcode_base64(text: str):
    buffer = io.BytesIO()
    code128 = barcode.get("code128", text, writer=ImageWriter())
    code128.write(buffer, options={"module_height": 8, "font_size": 8})
    encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"