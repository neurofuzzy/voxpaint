## BEHAVIOR
1. Any voxel can be marked as chamfered. Do not do validity checks when user is drawing.
2. Only alter the resolved model when the user edits a layer intersecting that voxel

## MODELS
A) Cube Voxel: 6 sides, 12 triangles.
B) Simple Ramp: 5 sides, 8 triangles. Square bottom. Ramped Top. 3 sides. Sloped sides are single triangle. Backside is a 2-triangle quad like the bottom.
C) Convex Corner Ramp: 4 sides, 6 triangles. Top triangles each have 2 vertices shared with the bottom.
D) Concave Corner Ramp: 6 sides, 10 triangles. Top triangles each have 1 vertex shared with the bottom.

Model origin is the 3d center of the voxel cube. This will eliminate the need for rotation offsets.

Models are rotated such that "top" faces toward the user in the orientation of the construction plane.
Models are rotated about the "up/top" axis such that the chamfer topology is seamless:
0) 0 degrees
1) 90 degrees
2) 180 degrees
3) 270 degrees

GIVEN A VOXEL CUBE with bottom vertices

D|A
-+-
C|B

AND TOP VERTICES

H|E
-+-
G|F

Where + is center and |,- are axes;

Model B sloped sides are ADH and BCG
Model B does not have E or F vertices

Model C sloped sides are BCG and CDH
Model C does not hav H,E or F vertices

Model D sloped sides are ABF and ADH
Model D does not have E vertex

(adjust face-winding accordingly)

# TEST
GIVEN A PLANE where - is empty, X is solid and Y is chamfer
```
--YYYY--
--YXXY--
YYYXXYYY
YXXXXXXY
YXXXXXXY
YYYXXYYY
--YXXY--
--YYYY--
```
RESULTING MODELS:
```
--CBBC--
--BAAB--
CBDAADBC
BAAAAAAB
BAAAAAAB
CBDAADBC
--BAAB--
--CBBC--
```
RESULTING ROTATIONS:
```
--3330--
--2--0--
333--000
2------0
2------0
222--121
--2--0--
--2221--
```
