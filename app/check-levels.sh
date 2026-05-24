#!/bin/sh
for L in 22 21 20 19 18 17 16 15 14 13 12 11 10; do
  D="/map-tiles/html/map_data/base/layer0_files/$L"
  J=$(ls $D/*.jpg 2>/dev/null | wc -l)
  W=$(ls $D/*.webp 2>/dev/null | wc -l)
  E=$(ls $D/*.empty 2>/dev/null | wc -l)
  echo "L=$L jpg=$J webp=$W empty=$E"
done
echo ---
ls /map-tiles/html/map_data/base/layer0_files/15/*.jpg 2>/dev/null | head -5
