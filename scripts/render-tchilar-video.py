from pathlib import Path
import json, wave, subprocess, shutil

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp" / "video"
OUT = ROOT / "output" / "video" / "demonstracao-tchilar.mp4"
FFMPEG = shutil.which("ffmpeg")
if not FFMPEG:
    raise SystemExit("ffmpeg não foi encontrado.")
items = json.loads((TMP/"narration.json").read_text(encoding="utf-8"))
concat = TMP/"clips.txt"
lines=[]
total=0
for idx, item in enumerate(items,1):
    audio_path=Path(item["audio"])
    if not audio_path.exists():
        raise SystemExit(f"Falta a narração: {audio_path}")
    with wave.open(str(audio_path),"rb") as wf:
        audio_seconds=wf.getnframes()/wf.getframerate()
    duration=max(5.5,audio_seconds+0.75)
    total+=duration
    frames=round(duration*24)
    video=TMP/f"clip-{idx:02d}.mp4"
    fade_out=max(0.5,duration-0.28)
    audio_out=max(0.25,audio_seconds-0.12)
    vf=(f"zoompan=z='min(zoom+0.00018,1.03)':d={frames}:s=1280x720:fps=24:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',"
        f"fade=t=in:st=0:d=0.25,fade=t=out:st={fade_out:.3f}:d=0.25,format=yuv420p")
    af=(f"afade=t=in:st=0:d=0.16,afade=t=out:st={audio_out:.3f}:d=0.18,"
        f"apad=pad_dur={duration-audio_seconds:.3f}")
    command=[FFMPEG,"-y","-hide_banner","-loglevel","error","-loop","1","-framerate","24","-i",item["image"],"-i",str(audio_path),
        "-filter_complex",f"[0:v]{vf}[v];[1:a]{af}[a]","-map","[v]","-map","[a]","-t",f"{duration:.3f}",
        "-c:v","libx264","-preset","medium","-crf","27","-pix_fmt","yuv420p","-r","24","-c:a","aac","-b:a","96k","-ar","48000","-ac","2","-movflags","+faststart",str(video)]
    subprocess.run(command,check=True)
    lines.append(f"file '{video.as_posix()}'")
    print(f"Cena {idx}/{len(items)} pronta ({duration:.1f}s)")
concat.write_text("\n".join(lines)+"\n",encoding="utf-8")
subprocess.run([FFMPEG,"-y","-hide_banner","-loglevel","error","-f","concat","-safe","0","-i",str(concat),"-c:v","copy","-af","loudnorm=I=-16:TP=-1.5:LRA=11","-c:a","aac","-b:a","96k","-ar","48000","-movflags","+faststart",str(OUT)],check=True)
print(f"Vídeo final: {OUT}")
print(f"Duração estimada: {total:.1f}s")
