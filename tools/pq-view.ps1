# View an HDR10 window capture on an SDR screen: a PrintWindow grab of the app in HDR10 holds PQ code values (BT.2020).
# This decodes them to nits, converts to BT.709, maps paper white to SDR white with a soft shoulder for the highlights
# above it, and writes an sRGB PNG; -Stats also prints the luminance percentiles in nits.
#   tools\pq-view.ps1 -In captures\x.png -Out captures\x-sdr.png [-White 300] [-Stats]
param([string]$In, [string]$Out, [float]$White = 300, [switch]$Stats, [switch]$Raw)   # -Raw: the app's F8 dump (PQ codes stored sRGB-encoded)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class PqView {
  static double Pq(double c) { const double m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
    double p = Math.Pow(Math.Max(c, 0), 1.0 / m2); return Math.Pow(Math.Max(p - c1, 0) / (c2 - c3 * p), 1.0 / m1) * 10000.0; }
  static double Srgb(double v) { v = Math.Max(0, Math.Min(1, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.Pow(v, 1 / 2.4) - 0.055; }
  public static string Run(string input, string output, double white, bool stats, bool raw) {
    var lut = new double[256]; for (int i = 0; i < 256; i++) { double c = i / 255.0; if (raw) c = c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4); lut[i] = Pq(c); }
    using (var src = new Bitmap(input)) {
      int w = src.Width, h = src.Height;
      var bd = src.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var buf = new byte[bd.Stride * h]; Marshal.Copy(bd.Scan0, buf, 0, buf.Length); src.UnlockBits(bd);
      var lum = stats ? new float[(w / 4) * (h / 4)] : null; int n = 0;
      for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
        int o = y * bd.Stride + x * 4;
        double r2 = lut[buf[o + 2]], g2 = lut[buf[o + 1]], b2 = lut[buf[o]];
        double r = 1.6604910 * r2 - 0.5876411 * g2 - 0.0728499 * b2, g = -0.1245505 * r2 + 1.1328999 * g2 - 0.0083494 * b2, b = -0.0181508 * r2 - 0.1005789 * g2 + 1.1187297 * b2;
        if (stats && (x & 3) == 0 && (y & 3) == 0 && n < lum.Length) lum[n++] = (float)(0.2126 * r + 0.7152 * g + 0.0722 * b);
        double[] c = { r / white, g / white, b / white };
        for (int k = 0; k < 3; k++) { double v = Math.Max(c[k], 0); if (v > 0.8) v = 0.8 + 0.2 * (1 - Math.Exp(-(v - 0.8) / 0.2 * 1.0)) ; c[k] = v; }
        buf[o + 2] = (byte)Math.Round(Srgb(c[0]) * 255); buf[o + 1] = (byte)Math.Round(Srgb(c[1]) * 255); buf[o] = (byte)Math.Round(Srgb(c[2]) * 255); buf[o + 3] = 255;
      }
      using (var dst = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
        var dd = dst.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(buf, 0, dd.Scan0, buf.Length); dst.UnlockBits(dd); dst.Save(output, ImageFormat.Png);
      }
      if (!stats) return output;
      Array.Sort(lum, 0, n);
      Func<double, float> pc = q => lum[Math.Min(n - 1, (int)(q * n))];
      return string.Format("{0}  nits: p10 {1:F0}  p50 {2:F0}  p90 {3:F0}  p99 {4:F0}  max {5:F0}", output, pc(0.1), pc(0.5), pc(0.9), pc(0.99), lum[n - 1]);
    }
  }
}
'@
[PqView]::Run((Resolve-Path $In).Path, [IO.Path]::GetFullPath($Out), $White, [bool]$Stats, [bool]$Raw)
