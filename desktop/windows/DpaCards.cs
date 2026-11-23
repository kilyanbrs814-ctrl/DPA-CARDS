using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class DpaCards
{
    [STAThread]
    private static void Main()
    {
        foreach (var folder in new[] { Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.LocalApplicationData })
        {
            string root = Environment.GetFolderPath(folder);
            if (String.IsNullOrEmpty(root)) continue;
            string edge = Path.Combine(root, @"Microsoft\Edge\Application\msedge.exe");
            if (!File.Exists(edge)) continue;

            Process.Start(new ProcessStartInfo(edge, "--app=https://cards.digitalprojectagency.fr/connexion") { UseShellExecute = false });
            return;
        }
        MessageBox.Show("Microsoft Edge est nécessaire pour ouvrir DPA Cards.", "DPA Cards");
    }
}
