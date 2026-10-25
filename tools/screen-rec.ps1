# Record what the display actually shows - every presented frame, frame generation's included - with the Desktop
# Duplication grabber of an ffmpeg build already on the machine, and study it: which frames are new, how much each one
# changes, and a strip of consecutive frames (tone mapped for an SDR screen).
#   tools\screen-rec.ps1 -Seconds 1.5 [-Keys D3] [-Region "1440,810,960,540"] [-Prefix dda]     record (+ analyse)
#   tools\screen-rec.ps1 -Analyse [-From 40 -Count 12] [-Prefix dda]                               analyse only
# HDR desktop frames arrive as half-float scRGB (1.0 = 80 nits); the strip maps them with x/(1+x) after -Exposure.
param([double]$Seconds = 1.5, [string[]]$Keys = @(), [string]$Region = '1440,810,960,540', [string]$Prefix = 'dda',
      [switch]$Analyse, [int]$From = 0, [int]$Count = 16, [int]$Cols = 4, [float]$Exposure = 0.5, [string]$Title = 'Manchester RTX',
      [int]$Split = 0)   # -Split x: also log the mean left and right of column x (e.g. a glass panel against open scene)
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'captures\dda'
New-Item -ItemType Directory -Force $dir | Out-Null
$raw = Join-Path $dir "$Prefix.raw"
$r = $Region.Split(',') | ForEach-Object { [int]$_ }
if (-not $Analyse) {
    $ff = @('C:\Program Files\ASUS CyberView Portal\bin\ffmpeg.exe', 'C:\Program Files\rog_strix_lc_iv\bin\ffmpeg.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $ff) { throw 'no ffmpeg with ddagrab found' }
    if ($Keys.Count) { & powershell -NoProfile -File (Join-Path $PSScriptRoot 'snap-window.ps1') -Out (Join-Path $dir 'keys.png') -Keys ($Keys -join ',') -Wait 0 -Title $Title | Out-Null }
    & $ff -hide_banner -loglevel error -f lavfi -i "ddagrab=output_idx=0:framerate=240:draw_mouse=0:output_fmt=16bit:video_size=$($r[2])x$($r[3]):offset_x=$($r[0]):offset_y=$($r[1])" `
        -t $Seconds -vf "hwdownload,format=rgbaf16le" -f rawvideo -y $raw
}
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.IO; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices; using System.Text;
public static class ScreenRec {
  static float Half(ushort h) {
    int s = (h >> 15) & 1, e = (h >> 10) & 31, m = h & 1023; float v;
    if (e == 0) v = m / 1024f * (float)Math.Pow(2, -14); else if (e == 31) v = 65504; else v = (1 + m / 1024f) * (float)Math.Pow(2, e - 15);
    return s == 1 ? -v : v;
  }
  public static string Run(string raw, int w, int h, string outDir, string prefix, int from, int count, int cols, float exposure, int split) {
    long frameBytes = (long)w * h * 8; long n = new FileInfo(raw).Length / frameBytes;
    var sb = new StringBuilder(); var lut = new float[65536]; for (int i = 0; i < 65536; i++) lut[i] = Half((ushort)i);
    float[] prev = null; int unique = 0; var luma = new float[w * h];
    var strip = new Bitmap(w * cols, h * ((count + cols - 1) / cols)); var g = Graphics.FromImage(strip); var font = new Font("Segoe UI", 11, FontStyle.Bold);
    using (var fs = File.OpenRead(raw)) {
      var buf = new byte[frameBytes];
      for (int f = 0; f < n; f++) {
        fs.Read(buf, 0, (int)frameBytes);
        double mean = 0, left = 0, right = 0;
        for (int p = 0; p < w * h; p++) {
          int o = p * 8;
          float R = lut[buf[o] | buf[o + 1] << 8], G = lut[buf[o + 2] | buf[o + 3] << 8], B = lut[buf[o + 4] | buf[o + 5] << 8];
          luma[p] = 0.2126f * R + 0.7152f * G + 0.0722f * B; mean += luma[p];
          if (p % w < split) left += luma[p]; else right += luma[p];
        }
        mean /= w * h; left /= Math.Max(split, 1) * h; right /= Math.Max(w - split, 1) * h;
        double diff = 0; if (prev != null) for (int p = 0; p < w * h; p++) diff += Math.Abs(luma[p] - prev[p]); diff /= w * h;
        bool isNew = prev == null || diff > 1e-6; if (isNew) unique++;
        sb.AppendFormat("{0,3} mean {1,7:F4} diff {2,7:F4} left {3,7:F4} right {4,7:F4}{5}\n", f, mean, diff, left, right, isNew ? "" : "  (repeat)");
        if (prev == null) prev = new float[w * h]; Array.Copy(luma, prev, luma.Length);
        if (f >= from && f < from + count) {
          var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
          var bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb); var ob = new byte[bd.Stride * h];
          for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int o = (y * w + x) * 8, d = y * bd.Stride + x * 3;
            float[] c = { lut[buf[o + 4] | buf[o + 5] << 8], lut[buf[o + 2] | buf[o + 3] << 8], lut[buf[o] | buf[o + 1] << 8] };
            for (int k = 0; k < 3; k++) { float v = Math.Max(c[k], 0) * exposure; v = v / (1 + v); v = (float)Math.Pow(v, 1 / 2.2); ob[d + k] = (byte)(255 * Math.Min(v, 1f)); }
          }
          Marshal.Copy(ob, 0, bd.Scan0, ob.Length); bmp.UnlockBits(bd);
          int i = f - from; g.DrawImage(bmp, (i % cols) * w, (i / cols) * h);
          g.FillRectangle(Brushes.Black, (i % cols) * w, (i / cols) * h, 40, 20); g.DrawString(f.ToString(), font, Brushes.White, (i % cols) * w + 2, (i / cols) * h + 1);
          bmp.Dispose();
        }
      }
    }
    g.Dispose(); string sp = Path.Combine(outDir, prefix + "-strip.png"); strip.Save(sp, ImageFormat.Png); strip.Dispose();
    File.WriteAllText(Path.Combine(outDir, prefix + ".txt"), sb.ToString());
    return string.Format("{0} frames, {1} new; strip {2}; per-frame log {3}", n, unique, sp, Path.Combine(outDir, prefix + ".txt"));
  }
}
'@
[ScreenRec]::Run($raw, $r[2], $r[3], $dir, $Prefix, $From, $Count, $Cols, $Exposure, $(if ($Split -gt 0) { $Split } else { [int]($r[2] / 2) }))
