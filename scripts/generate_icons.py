from PIL import Image
import os

input_path = '/Users/enes/.gemini/antigravity/brain/db210e8c-b7c2-4a68-be9f-15d177c06fe3/itacm_app_icon_1784546414837.jpg'
public_dir = '/Users/enes/Desktop/ITACM/public'

try:
    img = Image.open(input_path).convert('RGBA')
    
    # Generate favicon.ico (multiple sizes)
    icon_sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
    img.save(os.path.join(public_dir, 'favicon.ico'), format='ICO', sizes=icon_sizes)
    
    # Generate apple-touch-icon.png
    img_180 = img.resize((180, 180), Image.Resampling.LANCZOS)
    img_180.save(os.path.join(public_dir, 'apple-touch-icon.png'))
    
    # Generate an icon for manifest if needed (e.g., 512x512)
    img_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    img_512.save(os.path.join(public_dir, 'icon-512.png'))
    print('Icons generated successfully in', public_dir)
except Exception as e:
    print('Error:', e)
