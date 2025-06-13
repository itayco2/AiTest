# Backend/clothing_fitting.py
import numpy as np
import torch
import trimesh
from typing import Dict, List, Tuple, Optional
from fastapi import HTTPException
from pydantic import BaseModel
import cv2
from scipy.spatial import cKDTree
import logging

logger = logging.getLogger(__name__)

class ClothingFitRequest(BaseModel):
    avatar_id: str
    clothing_id: str
    clothing_type: str  # shirt, pants, dress, etc.
    size: Optional[str] = "M"  # S, M, L, XL, etc.
    auto_fit: bool = True

class ClothingMetadata(BaseModel):
    clothing_id: str
    type: str
    brand: Optional[str] = None
    size_chart: Optional[Dict] = None
    material: Optional[str] = None
    stretchiness: float = 0.1  # 0-1 scale

class ClothingFitter:
    """Handles clothing fitting operations"""
    
    def __init__(self):
        self.size_mappings = self._init_size_mappings()
        self.clothing_templates = self._load_clothing_templates()
        
    def _init_size_mappings(self) -> Dict:
        """Initialize standard size mappings"""
        return {
            "XS": {"chest": 86, "waist": 71, "hips": 89},
            "S": {"chest": 91, "waist": 76, "hips": 94},
            "M": {"chest": 97, "waist": 81, "hips": 99},
            "L": {"chest": 107, "waist": 91, "hips": 109},
            "XL": {"chest": 117, "waist": 101, "hips": 119},
            "XXL": {"chest": 127, "waist": 111, "hips": 129}
        }
    
    def _load_clothing_templates(self) -> Dict:
        """Load base clothing templates"""
        # In production, these would be loaded from files
        return {
            "shirt": {"anchor_points": ["shoulders", "chest", "waist", "hem"]},
            "pants": {"anchor_points": ["waist", "hips", "thighs", "knees", "ankles"]},
            "dress": {"anchor_points": ["shoulders", "chest", "waist", "hips", "hem"]}
        }
    
    def fit_clothing_to_avatar(
        self, 
        avatar_mesh: trimesh.Trimesh, 
        clothing_mesh: trimesh.Trimesh,
        avatar_measurements: Dict,
        clothing_metadata: ClothingMetadata
    ) -> trimesh.Trimesh:
        """Main fitting function"""
        
        logger.info(f"Fitting clothing type: {clothing_metadata.type}")
        
        # Step 1: Analyze avatar body parts
        body_parts = self._segment_avatar(avatar_mesh)
        
        # Step 2: Extract clothing anchor points
        anchor_points = self._extract_anchor_points(clothing_mesh, clothing_metadata.type)
        
        # Step 3: Calculate scaling factors
        scale_factors = self._calculate_scale_factors(
            avatar_measurements, 
            clothing_metadata,
            anchor_points
        )
        
        # Step 4: Apply deformation
        if clothing_metadata.auto_fit:
            fitted_mesh = self._apply_smart_deformation(
                clothing_mesh,
                avatar_mesh,
                scale_factors,
                body_parts
            )
        else:
            fitted_mesh = self._apply_simple_scaling(clothing_mesh, scale_factors)
        
        # Step 5: Physics simulation for realistic draping
        fitted_mesh = self._simulate_cloth_physics(fitted_mesh, avatar_mesh)
        
        # Step 6: Collision detection and adjustment
        fitted_mesh = self._resolve_collisions(fitted_mesh, avatar_mesh)
        
        return fitted_mesh
    
    def _segment_avatar(self, avatar_mesh: trimesh.Trimesh) -> Dict:
        """Segment avatar into body parts"""
        vertices = avatar_mesh.vertices
        
        # Simple height-based segmentation (can be improved with ML)
        min_y, max_y = vertices[:, 1].min(), vertices[:, 1].max()
        height = max_y - min_y
        
        segments = {
            "head": vertices[vertices[:, 1] > min_y + 0.85 * height],
            "torso": vertices[
                (vertices[:, 1] > min_y + 0.4 * height) & 
                (vertices[:, 1] <= min_y + 0.85 * height)
            ],
            "legs": vertices[vertices[:, 1] <= min_y + 0.4 * height]
        }
        
        # Further segment torso
        torso_vertices = segments["torso"]
        if len(torso_vertices) > 0:
            chest_level = min_y + 0.7 * height
            waist_level = min_y + 0.55 * height
            
            segments["chest"] = torso_vertices[torso_vertices[:, 1] > chest_level]
            segments["waist"] = torso_vertices[
                (torso_vertices[:, 1] > waist_level) & 
                (torso_vertices[:, 1] <= chest_level)
            ]
        
        return segments
    
    def _extract_anchor_points(
        self, 
        clothing_mesh: trimesh.Trimesh, 
        clothing_type: str
    ) -> Dict[str, np.ndarray]:
        """Extract key anchor points from clothing mesh"""
        vertices = clothing_mesh.vertices
        
        anchor_points = {}
        
        if clothing_type == "shirt":
            # Find shoulder points (highest points on sides)
            top_y = vertices[:, 1].max()
            shoulder_vertices = vertices[vertices[:, 1] > top_y - 0.1]
            
            # Left and right shoulders
            left_shoulder = shoulder_vertices[shoulder_vertices[:, 0] < 0].mean(axis=0)
            right_shoulder = shoulder_vertices[shoulder_vertices[:, 0] > 0].mean(axis=0)
            
            anchor_points["left_shoulder"] = left_shoulder
            anchor_points["right_shoulder"] = right_shoulder
            
            # Chest level (approximate)
            chest_y = top_y - 0.2
            chest_vertices = vertices[
                (vertices[:, 1] > chest_y - 0.05) & 
                (vertices[:, 1] < chest_y + 0.05)
            ]
            anchor_points["chest_center"] = chest_vertices.mean(axis=0)
            
            # Waist and hem
            bottom_y = vertices[:, 1].min()
            anchor_points["hem"] = vertices[vertices[:, 1] < bottom_y + 0.1].mean(axis=0)
            
        elif clothing_type == "pants":
            # Waistband
            top_y = vertices[:, 1].max()
            waist_vertices = vertices[vertices[:, 1] > top_y - 0.1]
            anchor_points["waistband"] = waist_vertices.mean(axis=0)
            
            # Leg separation
            bottom_y = vertices[:, 1].min()
            mid_y = (top_y + bottom_y) / 2
            
            mid_vertices = vertices[
                (vertices[:, 1] > mid_y - 0.1) & 
                (vertices[:, 1] < mid_y + 0.1)
            ]
            
            # Separate left and right legs
            left_leg = mid_vertices[mid_vertices[:, 0] < 0].mean(axis=0)
            right_leg = mid_vertices[mid_vertices[:, 0] > 0].mean(axis=0)
            
            anchor_points["left_thigh"] = left_leg
            anchor_points["right_thigh"] = right_leg
            
        return anchor_points
    
    def _calculate_scale_factors(
        self,
        avatar_measurements: Dict,
        clothing_metadata: ClothingMetadata,
        anchor_points: Dict
    ) -> Dict[str, float]:
        """Calculate scaling factors for different body parts"""
        
        # Get target size measurements
        target_size = clothing_metadata.size or "M"
        size_measurements = self.size_mappings.get(target_size, self.size_mappings["M"])
        
        scale_factors = {}
        
        # Calculate scales based on measurement differences
        if "chest" in avatar_measurements:
            scale_factors["chest"] = avatar_measurements["chest"] / size_measurements["chest"]
        
        if "waist" in avatar_measurements:
            scale_factors["waist"] = avatar_measurements["waist"] / size_measurements["waist"]
        
        if "hips" in avatar_measurements:
            scale_factors["hips"] = avatar_measurements["hips"] / size_measurements["hips"]
        
        # Apply stretchiness factor
        stretch_factor = 1.0 + clothing_metadata.stretchiness
        for key in scale_factors:
            scale_factors[key] = min(scale_factors[key], stretch_factor)
        
        return scale_factors
    
    def _apply_smart_deformation(
        self,
        clothing_mesh: trimesh.Trimesh,
        avatar_mesh: trimesh.Trimesh,
        scale_factors: Dict[str, float],
        body_parts: Dict
    ) -> trimesh.Trimesh:
        """Apply intelligent mesh deformation"""
        
        # Create a copy of the clothing mesh
        deformed_mesh = clothing_mesh.copy()
        vertices = deformed_mesh.vertices.copy()
        
        # Build KD-tree for nearest neighbor search
        avatar_tree = cKDTree(avatar_mesh.vertices)
        
        # For each clothing vertex, find nearest avatar vertex and apply weighted deformation
        for i, vertex in enumerate(vertices):
            # Find nearest avatar vertex
            dist, idx = avatar_tree.query(vertex)
            nearest_avatar_vertex = avatar_mesh.vertices[idx]
            
            # Determine which body part this belongs to
            body_part = self._get_body_part(nearest_avatar_vertex, body_parts)
            
            # Get appropriate scale factor
            if body_part == "chest":
                scale = scale_factors.get("chest", 1.0)
            elif body_part == "waist":
                scale = scale_factors.get("waist", 1.0)
            else:
                scale = 1.0
            
            # Apply radial scaling from body center
            center = avatar_mesh.center_mass
            direction = vertex - center
            direction[1] = 0  # Don't scale vertically
            
            # Apply scaling with distance-based falloff
            falloff = np.exp(-dist * 0.5)  # Exponential falloff
            effective_scale = 1.0 + (scale - 1.0) * falloff
            
            vertices[i] = center + direction * effective_scale
        
        deformed_mesh.vertices = vertices
        return deformed_mesh
    
    def _apply_simple_scaling(
        self,
        clothing_mesh: trimesh.Trimesh,
        scale_factors: Dict[str, float]
    ) -> trimesh.Trimesh:
        """Apply simple non-uniform scaling"""
        scaled_mesh = clothing_mesh.copy()
        
        # Average scale factors
        avg_scale = np.mean(list(scale_factors.values()))
        
        # Apply scaling
        transform = trimesh.transformations.scale_matrix(avg_scale)
        scaled_mesh.apply_transform(transform)
        
        return scaled_mesh
    
    def _simulate_cloth_physics(
        self,
        clothing_mesh: trimesh.Trimesh,
        avatar_mesh: trimesh.Trimesh,
        iterations: int = 10
    ) -> trimesh.Trimesh:
        """Simple cloth physics simulation for draping effect"""
        
        # This is a simplified version - in production, use a proper physics engine
        vertices = clothing_mesh.vertices.copy()
        
        # Gravity vector
        gravity = np.array([0, -0.01, 0])
        
        # Build collision detection tree
        avatar_tree = cKDTree(avatar_mesh.vertices)
        
        for _ in range(iterations):
            # Apply gravity
            vertices += gravity
            
            # Collision detection and response
            for i, vertex in enumerate(vertices):
                dist, _ = avatar_tree.query(vertex)
                
                # If vertex is inside avatar, push it out
                if dist < 0.02:  # 2cm threshold
                    # Find surface normal and push vertex out
                    closest_point, _, triangle_id = trimesh.proximity.closest_point(
                        avatar_mesh, 
                        vertex.reshape(1, 3)
                    )
                    
                    normal = avatar_mesh.face_normals[triangle_id[0]]
                    vertices[i] = closest_point[0] + normal * 0.02
        
        clothing_mesh.vertices = vertices
        return clothing_mesh
    
    def _resolve_collisions(
        self,
        clothing_mesh: trimesh.Trimesh,
        avatar_mesh: trimesh.Trimesh
    ) -> trimesh.Trimesh:
        """Resolve any remaining collisions between clothing and avatar"""
        
        # Check for intersections
        collision = trimesh.collision.CollisionManager()
        collision.add_object('avatar', avatar_mesh)
        collision.add_object('clothing', clothing_mesh)
        
        colliding = collision.in_collision_internal()
        
        if colliding:
            # Simple resolution: inflate clothing slightly
            clothing_mesh.vertices *= 1.02
        
        return clothing_mesh
    
    def _get_body_part(self, vertex: np.ndarray, body_parts: Dict) -> str:
        """Determine which body part a vertex belongs to"""
        for part_name, part_vertices in body_parts.items():
            if len(part_vertices) > 0:
                # Check if vertex is within bounds of this body part
                min_bounds = part_vertices.min(axis=0)
                max_bounds = part_vertices.max(axis=0)
                
                if np.all(vertex >= min_bounds) and np.all(vertex <= max_bounds):
                    return part_name
        
        return "unknown"
    
    def auto_size_recommendation(
        self,
        avatar_measurements: Dict,
        clothing_metadata: ClothingMetadata
    ) -> str:
        """Recommend best clothing size based on avatar measurements"""
        
        best_size = "M"
        min_difference = float('inf')
        
        for size, size_measurements in self.size_mappings.items():
            # Calculate total difference
            diff = 0
            for key in ["chest", "waist", "hips"]:
                if key in avatar_measurements and key in size_measurements:
                    diff += abs(avatar_measurements[key] - size_measurements[key])
            
            if diff < min_difference:
                min_difference = diff
                best_size = size
        
        # Adjust for stretchiness
        if clothing_metadata.stretchiness > 0.3:
            # Can go one size down for stretchy materials
            sizes = list(self.size_mappings.keys())
            current_idx = sizes.index(best_size)
            if current_idx > 0:
                best_size = sizes[current_idx - 1]
        
        return best_size

# Additional utility functions
def load_clothing_from_image(image_path: str) -> Optional[trimesh.Trimesh]:
    """Convert 2D clothing image to 3D mesh (placeholder)"""
    # This would use AI models like PIFu or similar
    # For now, return None as placeholder
    logger.info(f"Loading clothing from image: {image_path}")
    return None

def apply_texture_to_clothing(
    clothing_mesh: trimesh.Trimesh,
    texture_path: str
) -> trimesh.Trimesh:
    """Apply texture to clothing mesh"""
    # Load texture
    texture = cv2.imread(texture_path)
    
    # UV mapping would go here
    # This is a simplified placeholder
    
    return clothing_mesh