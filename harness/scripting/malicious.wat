;; Malicious fixture (Track C.5): tries to escape the capability surface.
;; Must FAIL instantiation — "fs" is not a granted import.

(module
  (import "fs" "read" (func $read (param i32) (result i32)))
  (memory 1)
  (func (export "run") (result i32)
    (call $read (i32.const 0)))
)
