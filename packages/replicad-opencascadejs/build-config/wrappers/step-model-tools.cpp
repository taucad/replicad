#include <Interface_InterfaceModel.hxx>
#include <NCollection_HArray1.hxx>
#include <StepBasic_Product.hxx>
#include <StepBasic_ProductDefinition.hxx>
#include <StepBasic_ProductDefinitionFormation.hxx>
#include <StepGeom_Axis2Placement3d.hxx>
#include <StepGeom_CartesianPoint.hxx>
#include <StepGeom_Direction.hxx>
#include <StepRepr_ConstructiveGeometryRepresentation.hxx>
#include <StepRepr_ConstructiveGeometryRepresentationRelationship.hxx>
#include <StepRepr_PropertyDefinition.hxx>
#include <StepRepr_Representation.hxx>
#include <StepRepr_RepresentationItem.hxx>
#include <StepShape_ShapeDefinitionRepresentation.hxx>
#include <TCollection_HAsciiString.hxx>

#include <stdexcept>
#include <string>

class ReplicadStepModelTools {
public:
  ReplicadStepModelTools(
    const Handle(Interface_InterfaceModel)& model,
    const std::string& productName,
    int datumCount,
    double unitScale)
    : model_(model),
      subjectRepresentation_(FindProductRepresentation(model, productName)),
      items_(datumCount > 0
        ? new NCollection_HArray1<Handle(StepRepr_RepresentationItem)>(1, datumCount)
        : nullptr),
      unitScale_(unitScale),
      nextIndex_(1),
      datumCount_(datumCount) {}

  bool HasProductRepresentation() const {
    return !subjectRepresentation_.IsNull();
  }

  void AddDatum(
    const std::string& name,
    double originX,
    double originY,
    double originZ,
    double xAxisX,
    double xAxisY,
    double xAxisZ,
    double zAxisX,
    double zAxisY,
    double zAxisZ) {
    if (items_.IsNull() || nextIndex_ > datumCount_) {
      throw std::runtime_error("Invalid STEP datum count");
    }

    const Handle(TCollection_HAsciiString) empty = new TCollection_HAsciiString("");
    const Handle(StepGeom_CartesianPoint) point = new StepGeom_CartesianPoint();
    point->Init3D(empty, originX * unitScale_, originY * unitScale_, originZ * unitScale_);

    const Handle(StepGeom_Direction) xAxis = new StepGeom_Direction();
    xAxis->Init3D(empty, xAxisX, xAxisY, xAxisZ);

    const Handle(StepGeom_Direction) zAxis = new StepGeom_Direction();
    zAxis->Init3D(empty, zAxisX, zAxisY, zAxisZ);

    const Handle(StepGeom_Axis2Placement3d) placement = new StepGeom_Axis2Placement3d();
    placement->Init(new TCollection_HAsciiString(name.c_str()), point, true, zAxis, true, xAxis);
    items_->SetValue(nextIndex_++, placement);
  }

  void Commit() {
    if (model_.IsNull() || subjectRepresentation_.IsNull() || items_.IsNull() || nextIndex_ != datumCount_ + 1) {
      throw std::runtime_error("Incomplete STEP datum representation");
    }

    const Handle(StepRepr_ConstructiveGeometryRepresentation) representation =
      new StepRepr_ConstructiveGeometryRepresentation();
    representation->Init(
      new TCollection_HAsciiString("supplemental geometry"),
      items_,
      subjectRepresentation_->ContextOfItems());

    const Handle(StepRepr_ConstructiveGeometryRepresentationRelationship) relationship =
      new StepRepr_ConstructiveGeometryRepresentationRelationship();
    const Handle(TCollection_HAsciiString) empty = new TCollection_HAsciiString("");
    relationship->Init(empty, empty, subjectRepresentation_, representation);
    model_->AddWithRefs(relationship, 0, true);
  }

private:
  static Handle(StepRepr_Representation) FindProductRepresentation(
    const Handle(Interface_InterfaceModel)& model,
    const std::string& productName) {
    if (model.IsNull()) {
      return {};
    }

    for (int index = 1; index <= model->NbEntities(); ++index) {
      const Handle(StepShape_ShapeDefinitionRepresentation) shapeDefinition =
        Handle(StepShape_ShapeDefinitionRepresentation)::DownCast(model->Value(index));
      if (shapeDefinition.IsNull()) {
        continue;
      }

      const Handle(StepRepr_PropertyDefinition) propertyDefinition =
        shapeDefinition->Definition().PropertyDefinition();
      if (propertyDefinition.IsNull()) {
        continue;
      }

      const Handle(StepBasic_ProductDefinition) productDefinition =
        propertyDefinition->Definition().ProductDefinition();
      if (productDefinition.IsNull() || productDefinition->Formation().IsNull()) {
        continue;
      }

      const Handle(StepBasic_Product) product = productDefinition->Formation()->OfProduct();
      if (!product.IsNull() && !product->Name().IsNull() && productName == product->Name()->ToCString()) {
        return shapeDefinition->UsedRepresentation();
      }
    }

    return {};
  }

  Handle(Interface_InterfaceModel) model_;
  Handle(StepRepr_Representation) subjectRepresentation_;
  Handle(NCollection_HArray1<Handle(StepRepr_RepresentationItem)>) items_;
  double unitScale_;
  int nextIndex_;
  int datumCount_;
};
