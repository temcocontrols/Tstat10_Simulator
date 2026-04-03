# Convert C icon array to PNG image
# Usage:
# 1. Copy the C array (e.g., coolicon) from your firmware source.
# 2. Paste the pixel data into the 'icon_data' list below.
# 3. Set the correct width and height for the icon.
# 4. Run this script: python convert_icon_array.py
# 5. The output will be saved as 'output_icon.png'.

from PIL import Image

# Example: 32x32 icon, replace with your actual data
icon_data = [
    # Paste your C array data here, e.g.:
    # 0x0000, 0x0000, ...
]

width = 32  # Set icon width
height = 32  # Set icon height

def rgb565_to_rgb888(val):
    r = ((val >> 11) & 0x1F) << 3
    g = ((val >> 5) & 0x3F) << 2
    b = (val & 0x1F) << 3
    return (r, g, b)

if __name__ == "__main__":
    if not icon_data or width * height != len(icon_data):
        print("Please paste your icon data and set correct width/height.")
        exit(1)
    img = Image.new('RGB', (width, height))
    pixels = img.load()
    for y in range(height):
        for x in range(width):
            idx = y * width + x
            val = icon_data[idx]
            pixels[x, y] = rgb565_to_rgb888(val)
    img.save('output_icon.png')
    print("Saved as output_icon.png")
