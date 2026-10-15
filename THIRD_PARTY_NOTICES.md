# Third-Party Notices

## highway-radar-sabre-plus

The minimal read-only Waze RT protocol schema and wire behavior in
`lib/waze-rt-proto.ts` and `lib/waze-rt.ts` are adapted from the clean-room
reconstruction in [highway-radar-sabre-plus](https://github.com/nicglazkov/highway-radar-sabre-plus).

MIT License

Copyright (c) 2026 highway-radar-sabre-plus contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Speed-camera open data

Fixed speed / red-light camera locations are imported from open datasets. Each
marker displays its source attribution in the app:

- **OpenStreetMap** contributors — Open Database License (ODbL). Nodes tagged
  `highway=speed_camera` / `enforcement=*`.
- **Dirección General de Tráfico (DGT, Spain)** — national access point
  (nap.dgt.es), DATEX II, Creative Commons Attribution (CC-BY). Fixed cabins
  and average-speed sections, excluding the Basque Country and Catalonia.
- **Ministère de l'Intérieur (France)** — fixed-radar list on data.gouv.fr,
  Licence Ouverte 2.0.
- **City of Chicago** (Socrata) and **Washington DC DDOT** (ArcGIS) open data.

These sources are contacted only by the admin-triggered importer
(`lib/speed-cameras.ts`), never by the user-facing runtime.
