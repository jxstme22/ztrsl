#![deny(unsafe_op_in_unsafe_fn)]
// Windows GUI subsystem: without this the packaged exe is a console-subsystem
// app, so Windows opens a terminal next to it and closing that console
// terminates the whole app. This makes the exe a normal GUI program (no
// console; the close button works).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    local_squad_desktop_lib::run();
}
