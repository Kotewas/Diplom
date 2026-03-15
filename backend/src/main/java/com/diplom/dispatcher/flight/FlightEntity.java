package com.diplom.dispatcher.flight;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.time.LocalDateTime;

@Entity
@Table(name = "flights")
public class FlightEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private String id;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private String flightNumber;

    @Column(nullable = false)
    private LocalDateTime departureAt;

    @Column
    private LocalDateTime arrivalAt;

    @Column(nullable = false)
    private String fromAirportId;

    @Column(nullable = false)
    private String toAirportId;

    @Column(nullable = false)
    private Integer departureRiskScore;

    @Column(nullable = false)
    private Integer arrivalRiskScore;

    @Column(nullable = false)
    private Integer cruiseRiskScore;

    @Column(nullable = false)
    private Integer totalRisk;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String departureRiskFactors;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String arrivalRiskFactors;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String cruiseRiskFactors;

    @Column(nullable = false)
    private String feasibilityLabel;

    @Column(nullable = false)
    private String feasibilityClassName;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public String getFlightNumber() {
        return flightNumber;
    }

    public void setFlightNumber(String flightNumber) {
        this.flightNumber = flightNumber;
    }

    public LocalDateTime getDepartureAt() {
        return departureAt;
    }

    public void setDepartureAt(LocalDateTime departureAt) {
        this.departureAt = departureAt;
    }

    public LocalDateTime getArrivalAt() {
        return arrivalAt;
    }

    public void setArrivalAt(LocalDateTime arrivalAt) {
        this.arrivalAt = arrivalAt;
    }

    public String getFromAirportId() {
        return fromAirportId;
    }

    public void setFromAirportId(String fromAirportId) {
        this.fromAirportId = fromAirportId;
    }

    public String getToAirportId() {
        return toAirportId;
    }

    public void setToAirportId(String toAirportId) {
        this.toAirportId = toAirportId;
    }

    public Integer getDepartureRiskScore() {
        return departureRiskScore;
    }

    public void setDepartureRiskScore(Integer departureRiskScore) {
        this.departureRiskScore = departureRiskScore;
    }

    public Integer getArrivalRiskScore() {
        return arrivalRiskScore;
    }

    public void setArrivalRiskScore(Integer arrivalRiskScore) {
        this.arrivalRiskScore = arrivalRiskScore;
    }

    public Integer getCruiseRiskScore() {
        return cruiseRiskScore;
    }

    public void setCruiseRiskScore(Integer cruiseRiskScore) {
        this.cruiseRiskScore = cruiseRiskScore;
    }

    public Integer getTotalRisk() {
        return totalRisk;
    }

    public void setTotalRisk(Integer totalRisk) {
        this.totalRisk = totalRisk;
    }

    public String getDepartureRiskFactors() {
        return departureRiskFactors;
    }

    public void setDepartureRiskFactors(String departureRiskFactors) {
        this.departureRiskFactors = departureRiskFactors;
    }

    public String getArrivalRiskFactors() {
        return arrivalRiskFactors;
    }

    public void setArrivalRiskFactors(String arrivalRiskFactors) {
        this.arrivalRiskFactors = arrivalRiskFactors;
    }

    public String getCruiseRiskFactors() {
        return cruiseRiskFactors;
    }

    public void setCruiseRiskFactors(String cruiseRiskFactors) {
        this.cruiseRiskFactors = cruiseRiskFactors;
    }

    public String getFeasibilityLabel() {
        return feasibilityLabel;
    }

    public void setFeasibilityLabel(String feasibilityLabel) {
        this.feasibilityLabel = feasibilityLabel;
    }

    public String getFeasibilityClassName() {
        return feasibilityClassName;
    }

    public void setFeasibilityClassName(String feasibilityClassName) {
        this.feasibilityClassName = feasibilityClassName;
    }
}
