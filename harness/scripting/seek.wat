;; Seek-logic fixture (Track C.5): agent movement brain in WAT.
;;
;; Imports (the ENTIRE capability surface — nothing else is granted):
;;   heretek.query(i32) -> f32   ; 0=selfX 1=selfZ 2=targetX 3=targetZ
;;   heretek.emit(i32,f32,f32)   ; (action, x, z); action 1 = move
;; Export: run() -> i32 (1 = moved, 0 = arrived).
;;
;; Logic: step one unit toward the target on the dominant axis; emit the
;; move; report whether more travel remains. Pure + deterministic.

(module
  (import "heretek" "query" (func $query (param i32) (result f32)))
  (import "heretek" "emit" (func $emit (param i32 f32 f32)))
  (memory 1)
  (func (export "run") (result i32)
    (local $dx f32) (local $dz f32)
    (local $arrived i32) (local $xdom i32)
    (local $stepx f32) (local $stepz f32)
    (local.set $dx (f32.sub (call $query (i32.const 2)) (call $query (i32.const 0))))
    (local.set $dz (f32.sub (call $query (i32.const 3)) (call $query (i32.const 1))))
    ;; arrived when both |d| < 0.5
    (local.set $arrived
      (i32.and
        (f32.lt (f32.abs (local.get $dx)) (f32.const 0.5))
        (f32.lt (f32.abs (local.get $dz)) (f32.const 0.5))))
    (if (result i32) (local.get $arrived)
      (then (i32.const 0))
      (else
        ;; dominant axis, guarded against zero deltas
        (local.set $xdom
          (i32.and
            (f32.ge (f32.abs (local.get $dx)) (f32.abs (local.get $dz)))
            (f32.ne (local.get $dx) (f32.const 0.0))))
        (local.set $stepx
          (select (f32.copysign (f32.const 1.0) (local.get $dx))
                  (f32.const 0.0) (local.get $xdom)))
        (local.set $stepz
          (select (f32.const 0.0)
                  (f32.copysign (f32.const 1.0) (local.get $dz))
                  (i32.or (local.get $xdom)
                          (f32.eq (local.get $dz) (f32.const 0.0)))))
        (call $emit (i32.const 1)
          (f32.add (call $query (i32.const 0)) (local.get $stepx))
          (f32.add (call $query (i32.const 1)) (local.get $stepz)))
        (i32.const 1)))
  )
)
