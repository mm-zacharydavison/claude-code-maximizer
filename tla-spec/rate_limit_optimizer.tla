---------------------------- MODULE rate_limit_optimizer ----------------------------
EXTENDS Integers, Sequences, FiniteSets, Reals, TLC

CONSTANTS
    QUOTA,              \* Maximum usage per window (normalized to 100)
    WINDOW_SIZE,        \* Window duration in minutes (e.g., 300 for 5 hours)
    WORK_START,         \* Workday start in minutes from midnight (e.g., 450 for 07:30)
    WORK_END,           \* Workday end in minutes from midnight (e.g., 960 for 16:00)
    CALIBRATION_DAYS,   \* Days to collect data before optimization (e.g., 7)
    TIME_GRANULARITY,   \* Granularity for trigger search in minutes (e.g., 15)
    MAX_TIME            \* Simulation bound in minutes

VARIABLES
    clock,              \* Current time in minutes from midnight of day 0
    phase,              \* "bootstrap" | "calibrate" | "steady_state"
    day_count,          \* Number of completed days
    usage_log,          \* Function: (day, hour_bucket) -> usage_amount
    usage_profile,      \* Function: hour_bucket -> expected_usage (after calibration)
    trigger_time,       \* Optimal trigger time in minutes from midnight
    current_window,     \* Record: [start, end, usage_consumed]
    total_usage,        \* Cumulative usage for metrics
    wait_events,        \* Count of times we had to wait for reset (violation!)
    wasted_quota        \* Cumulative quota left on table at resets

vars == <<clock, phase, day_count, usage_log, usage_profile, 
          trigger_time, current_window, total_usage, wait_events, wasted_quota>>

-----------------------------------------------------------------------------
(* HELPER OPERATORS *)

\* Convert absolute clock time to time-of-day in minutes
TimeOfDay(t) == t % (24 * 60)

\* Convert absolute clock time to day number
DayOf(t) == t \div (24 * 60)

\* Get hour bucket (0-23) from time-of-day
HourBucket(tod) == tod \div 60

\* Check if time-of-day falls within work hours
IsWorkTime(tod) == tod >= WORK_START /\ tod < WORK_END

\* Calculate overlap between two intervals [a1,a2) and [b1,b2)
Overlap(a1, a2, b1, b2) == 
    LET start == IF a1 > b1 THEN a1 ELSE b1
        end   == IF a2 < b2 THEN a2 ELSE b2
    IN  IF end > start THEN end - start ELSE 0

\* Clamp value to range [lo, hi]
Clamp(x, lo, hi) == IF x < lo THEN lo ELSE IF x > hi THEN hi ELSE x

-----------------------------------------------------------------------------
(* USAGE PROFILE OPERATORS *)

\* Default usage profile when unknown (conservative uniform assumption)
DefaultProfile == [h \in 0..23 |-> QUOTA \div 10]

\* Compute mean usage for an hour bucket from logged data
ComputeHourlyMean(log, hour) ==
    LET entries == {<<d, h>> \in DOMAIN log : h = hour}
        values  == {log[e] : e \in entries}
    IN  IF entries = {} 
        THEN 0
        ELSE (CHOOSE sum \in Int : 
              sum = LET S == values IN 
                    IF S = {} THEN 0 
                    ELSE \* Sum approximation for TLA+
                         Cardinality(S) * (CHOOSE v \in S : TRUE))
             \div Cardinality(entries)

\* Build full profile from usage log
BuildProfile(log) ==
    [h \in 0..23 |-> ComputeHourlyMean(log, h)]

-----------------------------------------------------------------------------
(* WINDOW SCHEDULING OPERATORS *)

\* Generate window boundaries for a given trigger time across a workday
WindowsForTrigger(trig) ==
    LET 
        \* Generate reset times starting from trigger
        ResetTimes == {trig + (WINDOW_SIZE * n) : n \in 0..5}
        
        \* Filter to windows that overlap with workday
        RelevantWindows == {
            [start |-> r - WINDOW_SIZE, 
             end   |-> r,
             work_overlap_start |-> Clamp(r - WINDOW_SIZE, WORK_START, WORK_END),
             work_overlap_end   |-> Clamp(r, WORK_START, WORK_END)]
            : r \in ResetTimes
        }
    IN {w \in RelevantWindows : w.work_overlap_end > w.work_overlap_start}

\* Calculate expected usage in a window given a profile
ExpectedWindowUsage(profile, w) ==
    LET hours == {h \in 0..23 : 
                  h * 60 >= w.work_overlap_start /\ 
                  h * 60 < w.work_overlap_end}
    IN  LET usages == {profile[h] : h \in hours}
        IN  IF usages = {} THEN 0
            ELSE CHOOSE sum \in 0..1000 : 
                 \A u \in usages : sum >= u  \* Approximation

\* Check if a trigger time is valid (no window exceeds quota)
IsValidTrigger(profile, trig) ==
    \A w \in WindowsForTrigger(trig) :
        ExpectedWindowUsage(profile, w) <= QUOTA

\* Calculate minimum slack across all windows for a trigger
MinSlack(profile, trig) ==
    LET windows == WindowsForTrigger(trig)
        slacks  == {QUOTA - ExpectedWindowUsage(profile, w) : w \in windows}
    IN  IF slacks = {} THEN 0
        ELSE CHOOSE min \in slacks : \A s \in slacks : min <= s

\* Find optimal trigger time
\* Priority: 1) Valid (no overruns), 2) Max buckets, 3) Max min-slack
\*
\* IMPORTANT: Optimal triggers are almost always BEFORE work hours begin.
\* This is intentional - starting a window before work ensures full quota
\* is available when work begins. For example:
\*   - Work hours: 07:30-16:00
\*   - Optimal triggers: 05:00, 10:00, 15:00
\*   - Window at 05:00 covers 07:30-10:00 with full quota
\*
\* The scheduler must handle triggers outside work hours correctly,
\* especially around midnight boundaries and stale state from previous days.
FindOptimalTrigger(profile) ==
    LET
        \* Candidates range from midnight (0) to work start
        \* This allows triggers hours before work begins
        candidates == {t * TIME_GRANULARITY : t \in 0..(WORK_START \div TIME_GRANULARITY)}
        valid      == {t \in candidates : IsValidTrigger(profile, t)}
    IN  IF valid = {}
        THEN WORK_START  \* Fallback to naive start
        ELSE CHOOSE best \in valid :
             \A other \in valid :
                /\ Cardinality(WindowsForTrigger(best)) >=
                   Cardinality(WindowsForTrigger(other))
                /\ (Cardinality(WindowsForTrigger(best)) =
                    Cardinality(WindowsForTrigger(other))
                    => MinSlack(profile, best) >= MinSlack(profile, other))

-----------------------------------------------------------------------------
(* STATE MACHINE *)

TypeInvariant ==
    /\ clock \in 0..MAX_TIME
    /\ phase \in {"bootstrap", "calibrate", "steady_state"}
    /\ day_count \in 0..1000
    /\ trigger_time \in 0..(24*60)
    /\ current_window.usage_consumed >= 0
    /\ current_window.usage_consumed <= QUOTA + 1  \* +1 for boundary
    /\ wait_events >= 0
    /\ wasted_quota >= 0

Init ==
    /\ clock = 0
    /\ phase = "bootstrap"
    /\ day_count = 0
    /\ usage_log = [x \in {} |-> 0]  \* Empty function
    /\ usage_profile = DefaultProfile
    /\ trigger_time = WORK_START - 120  \* Conservative default: 2h before work
    /\ current_window = [start |-> 0, end |-> WINDOW_SIZE, usage_consumed |-> 0]
    /\ total_usage = 0
    /\ wait_events = 0
    /\ wasted_quota = 0

-----------------------------------------------------------------------------
(* ACTIONS *)

\* Time advances
Tick ==
    /\ clock' = clock + 1
    /\ UNCHANGED <<phase, day_count, usage_log, usage_profile, 
                   trigger_time, current_window, total_usage, 
                   wait_events, wasted_quota>>

\* Day boundary crossed - check for phase transition
NewDay ==
    LET new_day == DayOf(clock) > day_count
    IN  /\ new_day
        /\ day_count' = DayOf(clock)
        /\ IF day_count' = CALIBRATION_DAYS /\ phase = "bootstrap"
           THEN /\ phase' = "calibrate"
                /\ UNCHANGED <<usage_profile, trigger_time>>
           ELSE UNCHANGED <<phase, usage_profile, trigger_time>>
        /\ UNCHANGED <<clock, usage_log, current_window, total_usage, 
                       wait_events, wasted_quota>>

\* Calibration action - compute profile and optimal trigger
Calibrate ==
    /\ phase = "calibrate"
    /\ usage_profile' = BuildProfile(usage_log)
    /\ trigger_time' = FindOptimalTrigger(usage_profile')
    /\ phase' = "steady_state"
    /\ UNCHANGED <<clock, day_count, usage_log, current_window, 
                   total_usage, wait_events, wasted_quota>>

\* Window reset occurs
WindowReset ==
    LET tod == TimeOfDay(clock)
        window_end == (trigger_time + WINDOW_SIZE) % (24 * 60)
        is_reset_time == tod = window_end \/ 
                        (tod >= window_end /\ tod < window_end + TIME_GRANULARITY)
    IN  /\ is_reset_time
        /\ current_window.end <= clock
        /\ wasted_quota' = wasted_quota + (QUOTA - current_window.usage_consumed)
        /\ current_window' = [
               start |-> clock,
               end   |-> clock + WINDOW_SIZE,
               usage_consumed |-> 0
           ]
        /\ UNCHANGED <<clock, phase, day_count, usage_log, usage_profile, 
                       trigger_time, total_usage, wait_events>>

\* Attempt to consume usage
ConsumeUsage(amount) ==
    LET tod == TimeOfDay(clock)
        hour == HourBucket(tod)
        day == DayOf(clock)
        can_use == current_window.usage_consumed + amount <= QUOTA
    IN  /\ IsWorkTime(tod)
        /\ IF can_use
           THEN /\ current_window' = [current_window EXCEPT 
                                      !.usage_consumed = @ + amount]
                /\ total_usage' = total_usage + amount
                /\ wait_events' = wait_events
           ELSE /\ wait_events' = wait_events + 1  \* VIOLATION: had to wait
                /\ UNCHANGED <<current_window, total_usage>>
        /\ usage_log' = [usage_log EXCEPT ![<<day, hour>>] = 
                         IF <<day, hour>> \in DOMAIN usage_log 
                         THEN @+ amount 
                         ELSE amount]
        /\ UNCHANGED <<clock, phase, day_count, usage_profile, 
                       trigger_time, wasted_quota>>

\* Non-deterministic usage during work hours (for model checking)
UseQuota ==
    \E amount \in 1..20 : ConsumeUsage(amount)

-----------------------------------------------------------------------------
(* SPECIFICATION *)

Next ==
    \/ Tick
    \/ NewDay
    \/ Calibrate
    \/ WindowReset
    \/ UseQuota

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

-----------------------------------------------------------------------------
(* INVARIANTS AND PROPERTIES *)

\* Safety: We should never have to wait (soft goal, tracked via wait_events)
NoWaitViolation == wait_events = 0

\* After calibration, trigger should be optimal
TriggerOptimalAfterCalibration ==
    phase = "steady_state" => 
        trigger_time = FindOptimalTrigger(usage_profile)

\* Windows should reset correctly
WindowIntegrity ==
    current_window.usage_consumed <= QUOTA

\* Liveness: Eventually reach steady state
EventuallyCalibrated == <>(phase = "steady_state")

\* The algorithm should maximize bucket count
MaximizeBuckets ==
    phase = "steady_state" =>
        Cardinality(WindowsForTrigger(trigger_time)) >= 
        Cardinality(WindowsForTrigger(WORK_START))

-----------------------------------------------------------------------------
(* TEMPORAL PROPERTIES *)

\* Fair scheduling - usage opportunities are eventually taken
FairUsage == []<>(IsWorkTime(TimeOfDay(clock)) => 
                  current_window.usage_consumed > 0)

\* System eventually stabilizes
Stabilization == 
    <>[](phase = "steady_state" /\ 
         trigger_time = FindOptimalTrigger(usage_profile))

=============================================================================
