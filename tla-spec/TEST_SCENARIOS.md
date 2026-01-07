# Rate Limit Optimizer - Test Scenarios

## Overview

This document describes concrete test scenarios for the TLA+ specification.
Each scenario can be validated by model checking or by inspection.

---

## Test Suite 1: Unknown Usage (Bootstrap Phase)

### Scenario 1.1: Fresh Start
```
GIVEN:
  - No prior usage data
  - Workday: 07:30-16:00
  - Window: 5 hours
  - Quota: 100 units

WHEN:
  - System initializes

THEN:
  - Phase = "bootstrap"
  - Usage log is empty
  - Profile = DefaultProfile (uniform)
  - Trigger = conservative default (05:30 or similar)
  - No wait events

VERIFY:
  Init => /\ phase = "bootstrap"
          /\ DOMAIN usage_log = {}
          /\ trigger_time < WORK_START
```

### Scenario 1.2: Logging During Bootstrap
```
GIVEN:
  - System in bootstrap phase
  - Day 3 of 7

WHEN:
  - User consumes 15 units at 09:00
  - User consumes 25 units at 11:00
  - User consumes 10 units at 14:00

THEN:
  - usage_log[<<3, 9>>] = 15
  - usage_log[<<3, 11>>] = 25
  - usage_log[<<3, 14>>] = 10
  - Phase remains "bootstrap"
  - total_usage increased by 50

VERIFY:
  After sequence:
    /\ <<3, 9>> \in DOMAIN usage_log
    /\ usage_log[<<3, 9>>] = 15
    /\ phase = "bootstrap"
```

### Scenario 1.3: Transition to Calibration
```
GIVEN:
  - Day 6 complete
  - Usage log has 7 days of data

WHEN:
  - Day counter increments to 7

THEN:
  - Phase transitions to "calibrate"
  - Calibrate action becomes enabled

VERIFY:
  (phase = "bootstrap" /\ day_count = 6) ~> (phase = "calibrate")
```

### Scenario 1.4: Conservative Trigger Survives Burst
```
GIVEN:
  - Bootstrap phase
  - Default trigger at 05:30
  - User bursts 80 units in first hour of work

WHEN:
  - 07:30-08:30: 80 units consumed

THEN:
  - No wait event (20 units slack in window 05:30-10:30)
  - Window resets at 10:30 with fresh quota
  - Conservative trigger provided buffer

VERIFY:
  /\ current_window.usage_consumed = 80
  /\ current_window.usage_consumed <= QUOTA
  /\ wait_events = 0
```

---

## Test Suite 2: Known Usage (Steady State)

### Scenario 2.1: Profile Computation
```
GIVEN:
  Usage log (7 days):
    Hour 7:  [10, 12, 8, 15, 10, 11, 14]  -> mean = 11.4
    Hour 8:  [25, 30, 22, 28, 25, 27, 23] -> mean = 25.7
    Hour 9:  [20, 18, 22, 19, 21, 20, 18] -> mean = 19.7
    Hour 10: [15, 14, 16, 15, 14, 15, 15] -> mean = 14.9
    Hour 11: [10, 12, 11, 10, 11, 12, 10] -> mean = 10.9
    Hour 12: [8, 7, 9, 8, 8, 7, 9]        -> mean = 8.0
    Hour 13: [12, 11, 13, 12, 11, 12, 13] -> mean = 12.0
    Hour 14: [18, 20, 17, 19, 18, 20, 18] -> mean = 18.6
    Hour 15: [8, 7, 8, 9, 7, 8, 8]        -> mean = 7.9

WHEN:
  - Calibrate action executes

THEN:
  - usage_profile[7] ≈ 11
  - usage_profile[8] ≈ 26
  - usage_profile[9] ≈ 20
  - ... (rounded means)

VERIFY:
  After Calibrate:
    /\ usage_profile[8] \in 24..28
    /\ usage_profile[9] \in 18..22
```

### Scenario 2.2: Optimal Trigger Calculation (Standard Pattern)
```
GIVEN:
  Profile (per hour during work):
    07: 15    08: 25    09: 20    10: 15
    11: 10    12: 8     13: 12    14: 18    15: 8
  
  Total daily usage: 131 units

WHEN:
  - FindOptimalTrigger executes

ANALYSIS:
  Candidate trigger 04:30:
    W0: 04:30-09:30, work overlap 07:30-09:30 = 2h
        Usage: 15+25 = 40, Slack = 60 ✓
    W1: 09:30-14:30, work overlap 09:30-14:30 = 5h  
        Usage: 20+15+10+8+12 = 65, Slack = 35 ✓
    W2: 14:30-19:30, work overlap 14:30-16:00 = 1.5h
        Usage: 18+8 = 26, Slack = 74 ✓
    
    Buckets: 3, Min slack: 35

  Candidate trigger 05:30:
    W0: 05:30-10:30, work overlap 07:30-10:30 = 3h
        Usage: 15+25+20 = 60, Slack = 40 ✓
    W1: 10:30-15:30, work overlap 10:30-15:30 = 5h
        Usage: 15+10+8+12+18 = 63, Slack = 37 ✓
    W2: 15:30-20:30, work overlap 15:30-16:00 = 0.5h
        Usage: 8, Slack = 92 ✓
    
    Buckets: 3, Min slack: 37 ← BETTER

THEN:
  - trigger_time = 05:30 (330 minutes)
  - 3 buckets available
  - Minimum slack = 37

VERIFY:
  /\ trigger_time = 330
  /\ Cardinality(WindowsForTrigger(330)) = 3
  /\ MinSlack(usage_profile, 330) >= 35
```

### Scenario 2.3: Heavy Morning Adaptation
```
GIVEN:
  Profile:
    07: 40    08: 35    09: 15    10: 10
    11: 8     12: 5     13: 8     14: 10    15: 5

WHEN:
  - FindOptimalTrigger executes

ANALYSIS:
  If trigger = 05:30:
    W0: 07:30-10:30 usage = 40+35+15 = 90, Slack = 10 ✓ (tight!)
  
  If trigger = 04:00:
    W0: 07:30-09:00 usage = 40+35 = 75, Slack = 25 ✓ (better)
    W1: 09:00-14:00 usage = 15+10+8+5+8 = 46, Slack = 54 ✓
    W2: 14:00-16:00 usage = 10+5 = 15, Slack = 85 ✓

THEN:
  - Trigger moves earlier to give morning more slack
  - trigger_time ≈ 04:00 (240 minutes)

VERIFY:
  /\ trigger_time < 300  \* Before 05:00
  /\ MinSlack(usage_profile, trigger_time) >= 20
```

### Scenario 2.4: Spiky Pattern Forces Window Split
```
GIVEN:
  Profile:
    07: 10    08: 60    09: 10    10: 10
    11: 10    12: 50    13: 10    14: 10    15: 10

WHEN:
  - FindOptimalTrigger executes

ANALYSIS:
  Spike at 08:00 (60) and 12:00 (50) cannot be in same window
  Must have reset between them
  
  Trigger = 03:00:
    W0: 03:00-08:00, work overlap 07:30-08:00 = 0.5h
        Usage: 10 (partial), next hour is 60
        PROBLEM: 08:00-08:59 is in W1
    W1: 08:00-13:00, overlap 08:00-13:00
        Usage: 60+10+10+10+50 = 140 > 100 ✗ INVALID

  Trigger = 02:30:
    W0: 02:30-07:30, work overlap = 0
    W1: 07:30-12:30, usage = 10+60+10+10+10 = 100 ✓ EXACT
    W2: 12:30-17:30, usage = 50+10+10+10 = 80 ✓
    
    Buckets: 2 (W0 has no work overlap), Min slack: 0 (risky)

  Trigger = 03:30:
    W1: 08:30-13:30, usage = (partial 08)+10+10+10+50+(partial 13)
        Need to calculate carefully...

THEN:
  - Algorithm finds valid trigger that separates spikes
  - May accept lower bucket count for safety

VERIFY:
  IsValidTrigger(usage_profile, trigger_time)
```

---

## Test Suite 3: Edge Cases

### Scenario 3.1: Single Window Day
```
GIVEN:
  - Work: 09:00-12:00 (3 hours)
  - Window: 5 hours
  - Cannot fit 2 window resets

WHEN:
  - FindOptimalTrigger executes

THEN:
  - Only 1 bucket available
  - Trigger = any time 04:00-09:00 works
  - Algorithm selects one that maximizes overlap

VERIFY:
  Cardinality(WindowsForTrigger(trigger_time)) = 1
```

### Scenario 3.2: Zero Usage Hours
```
GIVEN:
  Profile with lunch break:
    07: 20    08: 25    09: 20    10: 15
    11: 0     12: 0     13: 15    14: 20    15: 10

WHEN:
  - FindOptimalTrigger executes

THEN:
  - Zero hours don't break calculation
  - May position reset during zero-usage period

VERIFY:
  /\ IsValidTrigger(usage_profile, trigger_time)
  /\ usage_profile[11] = 0
  /\ usage_profile[12] = 0
```

### Scenario 3.3: Exactly At Quota
```
GIVEN:
  Profile summing to exactly 100 in a window:
    W1 overlap: hours sum to 100

WHEN:
  - Window executes with this usage

THEN:
  - No wait event (100 <= 100)
  - Slack = 0
  - Next window starts fresh

VERIFY:
  /\ current_window.usage_consumed = QUOTA
  /\ wait_events = 0
```

### Scenario 3.4: Usage Exceeds Any Valid Configuration
```
GIVEN:
  Profile:
    Every work hour = 50 units
    8.5 hours * 50 = 425 units required

WHEN:
  - FindOptimalTrigger executes

THEN:
  - No valid trigger exists (all windows overflow)
  - Fall back to naive trigger (WORK_START)
  - Accept that wait events will occur

VERIFY:
  /\ trigger_time = WORK_START
  /\ ~IsValidTrigger(usage_profile, WORK_START)
```

---

## Test Suite 4: Preference Verification

### Scenario 4.1: Waste Over Wait
```
GIVEN:
  Two valid triggers:
    A: 3 buckets, min_slack = 5, wastes 50 at EOD
    B: 3 buckets, min_slack = 30, wastes 80 at EOD

WHEN:
  - FindOptimalTrigger executes

THEN:
  - Selects B (higher min_slack)
  - Accepting more waste for more comfort

VERIFY:
  MinSlack(usage_profile, trigger_time) >= 30
```

### Scenario 4.2: Never Wait Constraint
```
GIVEN:
  - System in steady state
  - User attempts burst that would exceed quota

WHEN:
  - ConsumeUsage called with amount > remaining quota

THEN:
  - wait_events incremented (violation detected)
  - This is what we're trying to avoid

VERIFY:
  (current_window.usage_consumed + amount > QUOTA) => 
    wait_events' = wait_events + 1
```

---

## Test Suite 5: Recalibration

### Scenario 5.1: Usage Pattern Shift
```
GIVEN:
  - Day 14, steady state
  - Original profile heavy morning
  - Last 7 days usage shifted to afternoon

WHEN:
  - Weekly recalibration triggers

THEN:
  - Profile updates to reflect new pattern
  - Trigger recalculated
  - May shift later to accommodate afternoon

VERIFY:
  /\ usage_profile' /= usage_profile
  /\ trigger_time' = FindOptimalTrigger(usage_profile')
```

---

## Running the Tests

### With TLC Model Checker:
```bash
java -jar tla2tools.jar -config rate_limit_optimizer.cfg rate_limit_optimizer.tla
```

### Check specific invariant:
```bash
java -jar tla2tools.jar -config rate_limit_optimizer.cfg \
  -invariant NoWaitViolation rate_limit_optimizer.tla
```

### Check temporal property:
```bash
java -jar tla2tools.jar -config rate_limit_optimizer.cfg \
  -property EventuallyCalibrated rate_limit_optimizer.tla
```
