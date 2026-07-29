@echo off
rem Rebuild audios/pv_743.mp3 from the concert disc beside this script.
rem
rem   -nostdin      do not read stdin
rem   -y            overwrite the output
rem   -ss 600       coarse seek, applied before -i
rem   -ss 10.4575   fine seek, applied after -i, so the cut starts at 610.4575s
rem   -t 306        how many seconds to take
rem   -map 0:1      take audio stream 1, the disc's lossless LPCM
rem   -af volume    gain applied before encoding
rem   -c:a -b:a     encoder and output bitrate
ffmpeg -nostdin -y -ss 600 -i "%~dp0\00001.m2ts" -ss 10.4575 -t 306 -map 0:1 -af "volume=-1dB" -c:a libmp3lame -b:a 192k "%~dp0..\audios\pv_743.mp3"
