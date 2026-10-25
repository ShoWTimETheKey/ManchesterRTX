# Study a developer recording (F9 in the app, or MRTX_RECORD_STARTUP=N): captures\rec-NN.bmp + rec.csv
#   tools\rec-view.ps1 -Crop "x,y,w,h" -From 10 -Count 8 -Out captures\rec-crop.png [-Zoom 2]   consecutive crops side by side
#   tools\rec-view.ps1 -Flicker -Out captures\rec-flicker.png [-From 0 -Count 48]                 flicker map + per-frame means
# The flicker map shows, per pixel, the mean |F(n+1) - 2F(n) + F(n-1)| of luma: steady motion and slow fades cancel out,
# frame-to-frame flicker (and aliasing that crawls) does not. Bright = flickers.
param([string]$Crop = '', [int]$From = 0, [int]$Count = 48, [string]$Out = 'captures\rec-view.png', [int]$Zoom = 1, [switch]$Flicker, [int]$Cols = 4, [float]$Gain = 8, [float]$Boost = 1, [string]$Dir = 'captures')   # -Dir: a folder of rec-NN.bmp (tools\rec-run.ps1)
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices; using System.Text;
public static class RecView {
  static float[] Luma(Bitmap b, int x0, int y0, int w, int h) {
    var bd = b.LockBits(new Rectangle(x0, y0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var buf = new byte[bd.Stride * h]; Marshal.Copy(bd.Scan0, buf, 0, buf.Length); b.UnlockBits(bd);
    var l = new float[w * h];
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { int o = y * bd.Stride + x * 4; l[y * w + x] = (0.2126f * buf[o + 2] + 0.7152f * buf[o + 1] + 0.0722f * buf[o]) / 255f; }
    return l;
  }
  public static string FlickerMap(string[] files, string output, float gain) {
    int n = files.Length; float[] a = null, b = null, c = null, acc = null; int w = 0, h = 0, pairs = 0;
    var sb = new StringBuilder();
    for (int i = 0; i < n; i++) {
      using (var bmp = new Bitmap(files[i])) { w = bmp.Width; h = bmp.Height; a = b; b = c; c = Luma(bmp, 0, 0, w, h); }
      double mean = 0; foreach (var v in c) mean += v; sb.AppendFormat("{0}:{1:F4} ", i, mean / c.Length);
      if (acc == null) acc = new float[w * h];
      if (a != null) { for (int p = 0; p < acc.Length; p++) acc[p] += Math.Abs(c[p] - 2 * b[p] + a[p]); pairs++; }
    }
    using (var outBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
      var bd = outBmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      var buf = new byte[bd.Stride * h]; double total = 0;
      for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
        float f = acc[y * w + x] / Math.Max(pairs, 1); total += f;
        float v = Math.Min(1f, f * gain); int o = y * bd.Stride + x * 4;
        float bg = c[y * w + x] * 0.25f;   // the last frame, dimmed, for orientation
        buf[o + 2] = (byte)(255 * Math.Min(1f, bg + v)); buf[o + 1] = (byte)(255 * Math.Min(1f, bg + v * v)); buf[o] = (byte)(255 * bg); buf[o + 3] = 255;
      }
      Marshal.Copy(buf, 0, bd.Scan0, buf.Length); outBmp.UnlockBits(bd); outBmp.Save(output, ImageFormat.Png);
      return string.Format("{0}  mean flicker {1:F5}\nframe means: {2}", output, total / (w * h), sb.ToString());
    }
  }
  public static string Crops(string[] files, string output, int x0, int y0, int w, int h, int zoom, int cols, float boost) {
    int n = files.Length, rows = (n + cols - 1) / cols;
    using (var sheet = new Bitmap(w * zoom * cols, h * zoom * rows)) using (var g = Graphics.FromImage(sheet)) {
      g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor; g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
      var font = new Font("Segoe UI", 11, FontStyle.Bold);
      var ia = new ImageAttributes(); ia.SetColorMatrix(new ColorMatrix(new float[][] { new float[] { boost, 0, 0, 0, 0 }, new float[] { 0, boost, 0, 0, 0 }, new float[] { 0, 0, boost, 0, 0 }, new float[] { 0, 0, 0, 1, 0 }, new float[] { 0, 0, 0, 0, 1 } }));
      for (int i = 0; i < n; i++) using (var bmp = new Bitmap(files[i])) {
        int x = (i % cols) * w * zoom, y = (i / cols) * h * zoom;
        g.DrawImage(bmp, new Rectangle(x, y, w * zoom, h * zoom), x0, y0, w, h, GraphicsUnit.Pixel, ia);
        string label = System.IO.Path.GetFileNameWithoutExtension(files[i]);
        g.FillRectangle(Brushes.Black, x, y, g.MeasureString(label, font).Width + 8, 22); g.DrawString(label, font, Brushes.White, x + 4, y + 2);
      }
      sheet.Save(output, ImageFormat.Png);
    }
    return output;
  }
}
'@
$files = @(for ($i = $From; $i -lt $From + $Count; $i++) { $f = (Join-Path (Join-Path $root $Dir) ("rec-{0:D2}.bmp" -f $i)); if (Test-Path $f) { $f } })
if ($files.Count -eq 0) { throw 'no captures\rec-NN.bmp frames' }
$outPath = [IO.Path]::GetFullPath((Join-Path $root $Out))
if ($Flicker) { [RecView]::FlickerMap($files, $outPath, $Gain) }
else { $c = $Crop.Split(','); [RecView]::Crops($files, $outPath, [int]$c[0], [int]$c[1], [int]$c[2], [int]$c[3], $Zoom, $Cols, $Boost) }
