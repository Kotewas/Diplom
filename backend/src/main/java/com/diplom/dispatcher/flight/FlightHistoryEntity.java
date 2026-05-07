package com.diplom.dispatcher.flight;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "flight_history")
public class FlightHistoryEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private String id;

    @Column(nullable = false)
    private String flightId;

    @Column(nullable = false)
    private Instant changedAt;

    @Column(nullable = false)
    private Integer oldTotalRisk;

    @Column(nullable = false)
    private Integer newTotalRisk;

    @Column(columnDefinition = "TEXT")
    private String oldWeather;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private DispatcherDecision dispatcherDecision;

    @Column(columnDefinition = "TEXT")
    private String dispatcherDecisionReason;

    @Column
    private Integer dispatcherDecisionDelayMinutes;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getFlightId() {
        return flightId;
    }

    public void setFlightId(String flightId) {
        this.flightId = flightId;
    }

    public Instant getChangedAt() {
        return changedAt;
    }

    public void setChangedAt(Instant changedAt) {
        this.changedAt = changedAt;
    }

    public Integer getOldTotalRisk() {
        return oldTotalRisk;
    }

    public void setOldTotalRisk(Integer oldTotalRisk) {
        this.oldTotalRisk = oldTotalRisk;
    }

    public Integer getNewTotalRisk() {
        return newTotalRisk;
    }

    public void setNewTotalRisk(Integer newTotalRisk) {
        this.newTotalRisk = newTotalRisk;
    }

    public String getOldWeather() {
        return oldWeather;
    }

    public void setOldWeather(String oldWeather) {
        this.oldWeather = oldWeather;
    }

    public DispatcherDecision getDispatcherDecision() {
        return dispatcherDecision;
    }

    public void setDispatcherDecision(DispatcherDecision dispatcherDecision) {
        this.dispatcherDecision = dispatcherDecision;
    }

    public String getDispatcherDecisionReason() {
        return dispatcherDecisionReason;
    }

    public void setDispatcherDecisionReason(String dispatcherDecisionReason) {
        this.dispatcherDecisionReason = dispatcherDecisionReason;
    }

    public Integer getDispatcherDecisionDelayMinutes() {
        return dispatcherDecisionDelayMinutes;
    }

    public void setDispatcherDecisionDelayMinutes(Integer dispatcherDecisionDelayMinutes) {
        this.dispatcherDecisionDelayMinutes = dispatcherDecisionDelayMinutes;
    }
}
