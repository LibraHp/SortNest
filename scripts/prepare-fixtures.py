"""Download public test images only; never imports them into the user's library."""
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parents[1] / "artifacts" / "fixtures"
root.mkdir(parents=True, exist_ok=True)
sources = {
    "dog.jpg": "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg",
    "astronaut.png": "https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png",
    "coffee.png": "https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/coffee.png",
}
for name, url in sources.items():
    if not (root / name).exists():
        urllib.request.urlretrieve(url, root / name)
    print(name)
