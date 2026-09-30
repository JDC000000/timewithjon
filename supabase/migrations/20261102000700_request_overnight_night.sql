-- T1.6.U5 (wireframe 06-F): the guest's "Which night?" answer on an overnight Pitch Me request (single line, <=60).
alter table request add column if not exists overnight_night text check (char_length(overnight_night) <= 60);
