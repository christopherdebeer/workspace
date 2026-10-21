# Cloudfold

> Keep folding space and hiding symmetry until cloud happens.

A volumetric KIFS study. Drag to orbit, pinch or scroll to approach. **Hide symmetry** removes the visible mirror through domain warping, shear, seeded rotations between folds and noise erosion. **Gather** changes density; **Folds** changes recursive detail. Daylight, afterglow and storm relight the same volume. Hold time freezes evolution while keeping the camera and controls live. Another cloud changes the seed; the URL keeps seed and parameters.

## Construction

The core repeatedly folds with abs(), rotates, scales and translates the sample position, accumulating a multiscale sphere orbit trap. A soft ellipsoidal envelope bounds the medium. Ray marching integrates Beer–Lambert extinction front to back, with four samples toward the sun for self-shadow and a height-dependent ambient term. This is an artistic density field, not a meteorological simulation or an exact distance estimator.

Lower Hide symmetry to compare the same fold structure before distortion. Time moves the warping and erosion slowly; it does not randomly regenerate the cloud every frame. No image textures or external assets.

## Performance and reproducibility

`?seed=1947&conceal=.85&fullness=.55&folds=6&light=day` is the initial study. `light=dusk|storm`, `q=low`, `still` and `t=12` are supported. A preview uses 48 volume samples; the full study uses 80. Total pixel count is capped independently of device DPR, with resolution reduction after sustained slow frames. Hidden tabs stop drawing. Reduced-motion preference freezes time initially. WebGL 2 is required.

`window.__cloudfold.probe()` reports parameters, frames, render size and GL error for inspection.
